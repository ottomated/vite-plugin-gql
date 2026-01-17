import type { Expression, Node } from 'estree';
import {
	GraphQLError,
	stripIgnoredCharacters,
	type GraphQLSchema,
} from 'graphql';
import type MagicString from 'magic-string';
import type { ProgramNode, TransformPluginContext } from 'rollup';
import { walk } from 'zimmerframe';
import type { TypeMap } from './dts-watcher';
import { generate_typescript, location_to_index } from './codegen';
import type { Program } from 'oxc-parser';

export function find_import(
	ast: Node | Program,
	module_id: string,
): string | null {
	let import_name: string | null = null;
	walk(
		ast,
		{},
		{
			ImportDeclaration(node, { stop }) {
				if (node.source.value !== module_id) return;
				const specifier = node.specifiers.find(
					(s) => s.type === 'ImportDefaultSpecifier',
				);
				if (!specifier) return;
				import_name = specifier.local.name;
				stop();
			},
		},
	);
	return import_name;
}

type RollupNode<T> = T & { start: number; end: number };

export function walk_ast(
	{
		ast,
		import_name,
		schema,
		custom_scalars,
		throw_gql_errors,
		magic_string,
	}: {
		ast: ProgramNode | Program;
		import_name: string;
		schema: GraphQLSchema;
		custom_scalars: Record<string, string> | undefined;
		throw_gql_errors: boolean;
		magic_string: MagicString | undefined;
	},
	context: Pick<TransformPluginContext, 'warn' | 'error'>,
): TypeMap {
	const types: TypeMap = {};

	walk(
		ast as RollupNode<Node>,
		{},
		{
			_(_, { next }) {
				next();
			},
			CallExpression(node, { next }) {
				if (node.callee.type !== 'Identifier') return next();
				if (node.callee.name !== import_name) return next();

				const query = node.arguments[0] as RollupNode<Expression> | undefined;
				if (!query) {
					return context.error(`${node.callee.name} requires a query argument`);
				}
				let query_value: string;
				if (query.type === 'TemplateLiteral') {
					if (query.quasis.length !== 1) {
						return context.error(
							`The query argument to ${node.callee.name} can't have interpolation`,
							query.start,
						);
					}
					query_value =
						query.quasis[0]!.value.cooked ?? query.quasis[0]!.value.raw;
				} else if (
					query.type === 'Literal' &&
					typeof query.value === 'string'
				) {
					query_value = query.value;
				} else {
					return context.error(
						`The first argument to ${node.callee.name} must be a literal string (i.e. \`query { ... }\`)`,
						query.start,
					);
				}

				let minified: string;
				try {
					const typescript = generate_typescript(
						query_value,
						schema,
						custom_scalars,
					);
					types[query_value] = typescript;
					// Double stringify - one to turn it into JS, one because it's
					// passed to a json api
					minified = JSON.stringify(
						JSON.stringify(stripIgnoredCharacters(query_value)),
					);
				} catch (e) {
					let location = query.start;
					let message = String(e);
					if (e instanceof GraphQLError && e.locations?.length) {
						location =
							location_to_index(e.locations[0]!, query_value) + query.start;
						message = e.message;
					}
					if (throw_gql_errors) {
						return context.error(message, location);
					} else {
						context.warn(message, location);
					}
					types[query_value] = { error: message };
					minified = `(() => { throw new Error(${JSON.stringify(
						message,
					)}); })()`;
				}

				magic_string?.update(query.start, query.end, minified);
			},
		},
	);
	return types;
}
