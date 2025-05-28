import type { Plugin } from 'vite';
import module from './module.txt';
import type { Expression, Node } from 'estree';
import type { PluginContext, ProgramNode } from 'rollup';
import { find_import } from './ast';
import MagicString from 'magic-string';
import { walk } from 'zimmerframe';
import {
	generate_typescript,
	location_to_index,
	SCALAR_TYPES,
} from './codegen';
import { loadSchema, type LoadSchemaOptions } from '@graphql-tools/load';
import { UrlLoader } from '@graphql-tools/url-loader';
import type { GraphQLSchema } from 'graphql';
import { GraphQLError, isScalarType, stripIgnoredCharacters } from 'graphql';
import { DtsWriter } from './dts-writer';
import { SchemaWatcher } from './schema-watcher';

type RollupNode<T> = T & { start: number; end: number };

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
	/**
	 * A map of GraphQL scalar types to their typescript types
	 * @example { ID: 'string' }
	 */
	customScalars?: Record<string, string>;
	/**
	 * The config for watching the schema for changes.
	 */
	watchSchema?: WatchSchemaConfig;

}

// This is incase you want to change to having the headers inside the watch schema function -- not implemented, but avaialble
// TODO: add default interval and timeout values
export type WatchSchemaConfig = {
	/**
	 * The URL to the GraphQL schema
	 */
	url: string | ((env: Record<string, string | undefined>) => string);
	/**
	 * amount of time between each request in milliseconds
	 */
	interval?: number | null;
	/**
	 * Timeout duration in milliseconds used to cancel the fetching of the schema.
	 */
	timeout?: number | null;
	/**
	 * An object containing the environment variables you want passed onto the api when polling for a new schema.
	 * The keys dictate the header names. If the value is a string, the corresponding environment variable will be used
	 * directly. If the value is a function, the current environment will be passed to your function so you can perform any,
	 * logic you need
	 */
	headers?: Record<string, string | ((env: Record<string, string | undefined>) => string)> | ((env: Record<string, string | undefined>) => Record<string, string>);
};

export default function gql_tag_plugin(config: PluginConfig): Plugin {
	const {
		moduleId = '$gql',
		url,
		customScalars,
		outFile,
		watchSchema,
		headers = {},
	} = config;
	if (moduleId.includes("'")) throw new Error('Invalid moduleId');

	if (!('Content-Type' in headers)) {
		headers['Content-Type'] = 'application/json';
	}

	let schema_promise: Promise<GraphQLSchema> | undefined;
	let is_build: boolean;
	let schema_watcher: SchemaWatcher | undefined;

	const dts_writer = new DtsWriter(moduleId, outFile);

	async function load_schema(context: PluginContext) {
		const schema = await loadSchema(config.watchSchema?.url ?? config.url, {
			...config.schemaOptions,
			headers,
			loaders: [new UrlLoader()],
		});
		for (const [name, type] of Object.entries(schema.getTypeMap())) {
			if (!isScalarType(type)) continue;
			if (name in SCALAR_TYPES) continue;
			if (config.customScalars && name in config.customScalars) continue;
			context.warn(
				`Scalar '${name}' is missing from config.customScalars. Consider defining it.\n\nDescription: ${type.description ?? ''}`,
			);
		}

		return schema;
	}

	function handleSchemaChange(newSchema: GraphQLSchema, context: PluginContext) {
		schema_promise = Promise.resolve(newSchema);
		
		if (!is_build) {
			context.info('GraphQL schema updated');
		}
	}

	function handleSchemaError(error: Error, context: PluginContext) {
		if (!is_build) {
			context.warn(`Schema polling error: ${error.message}`);
		}
	}

	return {
		name: '@o7/vite-plugin-gql',
		config(_, env) {
			is_build = env.command === 'build';
		},
		buildStart() {
			if (!is_build && watchSchema) {
				schema_watcher = new SchemaWatcher(
					watchSchema,
					config.schemaOptions,
					(newSchema) => handleSchemaChange(newSchema, this),
					(error) => handleSchemaError(error, this)
				);
				schema_watcher.startPolling();
			}
		},
		buildEnd() {
			if (schema_watcher) {
				schema_watcher.stopPolling();
				schema_watcher = undefined;
			}
		},
		resolveId(id) {
			if (id === moduleId) {
				return '\0' + moduleId;
			}
		},
		load(id) {
			if (id === '\0' + moduleId) {
				return module
				// This can change aswell I just didnt want to disable the regular url option
					.replace('URL', JSON.stringify(watchSchema?.url ?? url))
					.replace('HEADERS', JSON.stringify(headers));
			}
		},
		async transform(code, id) {
			let ast: ProgramNode;
			try {
				ast = this.parse(code);
			} catch (_) {
				return;
			}
			const import_name = find_import(ast, moduleId);
			if (!import_name) return { code, ast };

			if (schema_watcher && schema_watcher.getCurrentSchema()) {
				schema_promise = Promise.resolve(schema_watcher.getCurrentSchema()!);
			} else {
				schema_promise ??= load_schema(this);
			}
			const schema = await schema_promise;

			const s = new MagicString(code);
			const types = new Map<
				string,
				| {
						variables: string | null;
						return_type: string;
				  }
				| {
						error: string;
				  }
			>();
			const throw_error = this.error.bind(this);
			const throw_warning = this.warn.bind(this);
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

						const query = node.arguments[0] as
							| RollupNode<Expression>
							| undefined;
						if (!query) {
							return throw_error(
								`${node.callee.name} requires a query argument`,
							);
						}
						let query_value: string;
						if (query.type === 'TemplateLiteral') {
							if (query.quasis.length !== 1) {
								return throw_error(
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
							return throw_error(
								`The first argument to ${node.callee.name} must be a literal string (i.e. \`query { ... }\`)`,
								query.start,
							);
						}

						let minified: string;
						try {
							const typescript = generate_typescript(
								query_value,
								schema,
								customScalars,
							);
							types.set(query_value, typescript);
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
							if (is_build) {
								return throw_error(message, location);
							} else {
								throw_warning(message, location);
							}
							types.set(query_value, { error: message });
							minified = `(() => { throw new Error(${JSON.stringify(
								message,
							)}); })()`;
						}

						s.update(query.start, query.end, minified);
					},
				},
			);

			dts_writer.update_file(id, types);

			return {
				code: s.toString(),
				map: s.generateMap(),
			};
		},
	};
}
