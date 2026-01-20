import type { Plugin } from 'vite';
import module from './module.js?raw';
import type { ProgramNode } from 'rollup';
import { find_import, walk_ast } from './ast';
import MagicString from 'magic-string';
import { type LoadSchemaOptions } from '@graphql-tools/load';
import { GraphQLSchema } from 'graphql';
import { DtsWatcher, load_schema } from './dts-watcher';
import { relative } from 'node:path';
import type { GlobalGenerator } from './bin';

export type PluginConfig = {
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
	 * A map of GraphQL scalar types to their typescript types
	 * @example { ID: 'string' }
	 */
	customScalars?: Record<string, string>;
} & (
	| {
			/**
			 * Whether to automatically generate types whenever a file changes.
			 * If disabled, types can be generated from the command line with the included `gql-typegen` script.
			 * @default {true}
			 */
			automaticallyGenerateTypes: false;
			/**
			 * The file to write the generated types to.
			 * @example "src/gql.d.ts"
			 */
			outFile?: string;
	  }
	| {
			/**
			 * Whether to automatically generate types whenever a file changes.
			 * If disabled, types can be generated from the command line with the included `gql-typegen` script.
			 * @default {true}
			 */
			automaticallyGenerateTypes?: boolean;
			/**
			 * The file to write the generated types to.
			 * @example "src/gql.d.ts"
			 */
			outFile: string;
	  }
);

type Global = typeof globalThis & {
	__gql_generator: GlobalGenerator;
};

export default function gql_tag_plugin(config: PluginConfig): Plugin {
	config.moduleId ??= '$gql';
	config.headers ??= {};
	config.automaticallyGenerateTypes ??= true;
	if (config.moduleId.includes("'")) throw new Error('Invalid moduleId');

	if (!('Content-Type' in config.headers)) {
		config.headers['Content-Type'] = 'application/json';
	}
	if (
		'__gql_generator' in globalThis &&
		typeof (globalThis as Global).__gql_generator === 'symbol'
	) {
		(globalThis as Global).__gql_generator = {
			config,
			files: new Map(),
		};
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
			if (!is_build && config.automaticallyGenerateTypes) {
				if (!config.outFile) {
					throw this.error('@o7/vite-plugin-gql: outFile is required');
				}
				dts_watcher = new DtsWatcher(
					config.moduleId!,
					config.outFile,
					schema_promise,
					config.customScalars,
				);
			}
		},
		buildStart() {
			load_schema(config, this.warn).then(resolve_schema);
		},
		resolveId(id) {
			if (id === config.moduleId) {
				return '\0' + config.moduleId;
			}
		},
		load(id) {
			if (id === '\0' + config.moduleId) {
				return module
					.replace('GQL_URL', JSON.stringify(config.url))
					.replace('GQL_HEADERS', JSON.stringify(config.headers));
			}
		},
		async transform(code, id) {
			let ast: ProgramNode;
			try {
				ast = this.parse(code);
			} catch (_) {
				return;
			}
			const import_name = find_import(ast, config.moduleId!);
			if (!import_name) return { code, ast };

			const schema = await schema_promise;

			const s = new MagicString(code);
			const types = walk_ast(
				{
					ast,
					schema,
					custom_scalars: config.customScalars,
					import_name,
					throw_gql_errors: is_build,
					magic_string: s,
				},
				this,
			);

			dts_watcher?.update_file(id, types);

			if ('__gql_generator' in globalThis) {
				(globalThis as Global).__gql_generator.files.set(
					relative(process.cwd(), id),
					{
						ast,
						import_name,
					},
				);
			}

			return {
				code: s.toString(),
				map: s.generateMap(),
			};
		},
	};
}
