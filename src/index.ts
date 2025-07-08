import type { Plugin } from 'vite';
import module from './module.txt';
import type { ProgramNode } from 'rollup';
import { find_import, walk_ast } from './ast';
import MagicString from 'magic-string';
import { SCALAR_TYPES } from './codegen';
import { loadSchema, type LoadSchemaOptions } from '@graphql-tools/load';
import { UrlLoader } from '@graphql-tools/url-loader';
import { GraphQLSchema } from 'graphql';
import { isScalarType } from 'graphql';
import { DtsWatcher } from './dts-watcher';

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
}

export default function gql_tag_plugin(config: PluginConfig): Plugin {
	const {
		moduleId = '$gql',
		url,
		customScalars,
		outFile,
		headers = {},
	} = config;
	if (moduleId.includes("'")) throw new Error('Invalid moduleId');

	if (!('Content-Type' in headers)) {
		headers['Content-Type'] = 'application/json';
	}

	let resolve_schema: (schema: GraphQLSchema) => void;
	const schema_promise = new Promise<GraphQLSchema>((resolve) => {
		resolve_schema = resolve;
	});
	let is_build: boolean;

	let dts_watcher: DtsWatcher | undefined;

	return {
		name: '@o7/vite-plugin-gql',
		config(_, env) {
			is_build = env.command === 'build';
			if (!is_build) {
				dts_watcher = new DtsWatcher(
					moduleId,
					outFile,
					schema_promise,
					customScalars,
				);
			}
		},
		buildStart() {
			loadSchema(config.url, {
				...config.schemaOptions,
				headers,
				loaders: [new UrlLoader()],
			}).then((schema) => {
				for (const [name, type] of Object.entries(schema.getTypeMap())) {
					if (!isScalarType(type)) continue;
					if (name in SCALAR_TYPES) continue;
					if (config.customScalars && name in config.customScalars) continue;
					this.warn(
						`Scalar '${name}' is missing from config.customScalars. Consider defining it.\n\nDescription: ${type.description ?? ''}`,
					);
				}
				resolve_schema(schema);
			});
		},
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
		async transform(code, id) {
			let ast: ProgramNode;
			try {
				ast = this.parse(code);
			} catch (_) {
				return;
			}
			const import_name = find_import(ast, moduleId);
			if (!import_name) return { code, ast };

			const schema = await schema_promise;

			const s = new MagicString(code);
			const types = walk_ast(
				{
					ast,
					schema,
					custom_scalars: customScalars,
					import_name,
					throw_gql_errors: is_build,
					magic_string: s,
				},
				this,
			);

			dts_watcher?.update_file(id, types);

			return {
				code: s.toString(),
				map: s.generateMap(),
			};
		},
	};
}
