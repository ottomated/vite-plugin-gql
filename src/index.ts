import type { Plugin } from 'vite';
import module from './module.txt';
import type { Expression, Node } from 'estree';
import type { ProgramNode } from 'rollup';
import { find_import } from './ast';
import MagicString from 'magic-string';
import { walk } from 'zimmerframe';
import { generate_typescript } from './codegen';
import { loadSchema, type LoadSchemaOptions } from '@graphql-tools/load';
import { UrlLoader } from '@graphql-tools/url-loader';
import type { GraphQLSchema } from 'graphql';
import { writeFile } from 'fs/promises';

interface PluginConfig {
	/**
	 * The place to import the gql tag from. Defaults to `$gql`.
	 */
	moduleId?: string;
	/**
	 * The URL to the GraphQL endpoint.
	 */
	url: string;
	/**
	 * Headers to send with the request.
	 */
	headers?: Record<string, string>;
	/**
	 * Options to pass to the schema loader.
	 */
	schemaOptions?: Omit<LoadSchemaOptions, 'loaders' | 'headers'>;
	/**
	 * The file to write the generated types to.
	 * @example "src/gql.d.ts"
	 */
	outFile: string;
}

export default function gql_tag_plugin(config: PluginConfig): Plugin {
	const { moduleId = '$gql', url, outFile, headers = {} } = config;
	if (moduleId.includes("'")) throw new Error('Invalid moduleId');

	if (!('Content-Type' in headers)) {
		headers['Content-Type'] = 'application/json';
	}

	let schema_promise: Promise<GraphQLSchema> | undefined;

	return {
		name: 'vite-plugin-gql-tag',
		resolveId(id) {
			if (id === moduleId) {
				return '\0' + moduleId;
			}
		},
		load(id) {
			if (id === '\0' + moduleId) {
				return module
					.replace('URL', JSON.stringify(url))
					.replace('HEADERS', JSON.stringify(headers));
			}
		},
		async transform(code) {
			let ast: ProgramNode;
			try {
				ast = this.parse(code);
			} catch (_) {
				return;
			}
			const import_name = find_import(ast, moduleId);
			if (!import_name) return { code, ast };

			schema_promise ??= loadSchema(config.url, {
				...config.schemaOptions,
				headers,
				loaders: [new UrlLoader()],
			});
			const schema = await schema_promise;

			const s = new MagicString(code);
			const types = new Map<
				string,
				{
					variables: string;
					return_type: string;
				}
			>();

			walk(
				ast as Node,
				{},
				{
					_(_, { next }) {
						next();
					},
					CallExpression(node) {
						if (node.type !== 'CallExpression') return;
						if (node.callee.type !== 'Identifier') return;
						if (node.callee.name !== import_name) return;

						const query = node.arguments[0] as
							| (Expression & { start: number; end: number })
							| undefined;
						if (query?.type !== 'TemplateLiteral') {
							console.log(query);
							throw new Error(
								'The first argument to gql must be a tagged template literal',
							);
						}
						const query_value = query.quasis[0]?.value.raw;
						if (typeof query_value !== 'string') {
							throw new Error('Missing query value');
						}

						types.set(query_value, generate_typescript(query_value, schema));

						const minified = query_value; //minify_graphql(query_value);

						s.update(
							query.start,
							query.end,
							// Double stringify - one to turn it into JS, one because it's
							// passed to a json api
							JSON.stringify(JSON.stringify(minified)),
						);
					},
				},
			);

			const dts =
				`declare module '${moduleId}' {\n` +
				[...types.entries()]
					.map(
						([query, { variables, return_type }]) =>
							`	export default function gql(
		query: ${JSON.stringify(query)},
		variables: ${variables}
	): Promise<(${return_type})>;`,
					)
					.join('\n') +
				`
	export default function gql(
		query: string,
		variables: unknown
	): Promise<unknown>;
}\n`;

			writeFile(outFile, dts);
			return {
				code: s.toString(),
				map: s.generateMap(),
			};
		},
	};
}
