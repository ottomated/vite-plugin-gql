#!/usr/bin/env node
import type { PluginConfig } from '.';
import { load_schema, write_dts_file, type TypeMap } from './dts-watcher';
import { loadConfigFromFile, build } from 'vite';
import { fdir } from 'fdir';
import { parseArgs, styleText } from 'node:util';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { find_import, walk_ast } from './ast';
import { parseSync, type Program } from 'oxc-parser';
import type { ProgramNode } from 'rollup';

export type GlobalGenerator = {
	files: Map<
		string,
		{
			ast: Program | ProgramNode;
			import_name: string;
		}
	>;
	config: PluginConfig;
};

type Global = typeof globalThis & {
	__gql_generator: GlobalGenerator | symbol;
};
async function cli() {
	const { values: args } = parseArgs({
		args: process.argv.slice(2),
		options: {
			'from-vite-build': {
				type: 'boolean',
			},
			'from-glob': {
				type: 'string',
				multiple: true,
			},
			'out-file': {
				type: 'string',
			},
			'vite-config': {
				type: 'string',
			},
		},
	});
	const usage = `\nUsage: ${styleText(['green'], 'gql-typegen --from-vite-build')}     (runs \`vite build\` to collect gql queries)
 OR    ${styleText(['green'], 'gql-typegen --from-glob <glob>')}    (e.g. 'src/**/*' - collects gql queries from matching files)

Options:
  --vite-config <path>   The path to your vite config file. Defaults to finding vite.config.* in the current directory.
  --out-file <path>      The path to the file to write the generated types to. Defaults to the file defined in your vite config.
`;

	if (args['from-vite-build'] && args['from-glob']) {
		// eslint-disable-next-line no-console
		console.error(usage);
		// eslint-disable-next-line no-console
		console.error(
			styleText(['red'], 'Cannot use both --from-vite-build and --from-glob.'),
		);
		process.exit(1);
	}
	if (!args['from-vite-build'] && !args['from-glob']) {
		// eslint-disable-next-line no-console
		console.error(usage);
		process.exit(1);
	}

	(globalThis as Global).__gql_generator = Symbol();
	const output = await loadConfigFromFile(
		{
			command: 'build',
			mode: 'production',
		},
		args['vite-config'],
	);
	if (!output) {
		// eslint-disable-next-line no-console
		console.error(
			`Could not find vite config${args['vite-config'] ? ` at ${args['vite-config']}` : ''}.`,
		);
		process.exit(1);
	}
	const generator = (globalThis as Global).__gql_generator;
	if (typeof generator === 'symbol') {
		// eslint-disable-next-line no-console
		console.error(
			'Could not find the @o7/vite-plugin-gql plugin in your vite config.',
		);
		process.exit(1);
	}
	const out_file = args['out-file'] ?? generator.config.outFile;
	if (!out_file) {
		// eslint-disable-next-line no-console
		console.error(
			`--out-file is required when your vite config does not define \`outFile\`.`,
		);
		process.exit(1);
	}

	if (args['from-vite-build']) {
		// eslint-disable-next-line no-console
		console.log('Running vite build...');
		await build({
			build: {
				outDir: join(await realpath(tmpdir()), 'o7-vite-plugin-gql'),
				emptyOutDir: true,
			},
		});
	} else {
		const api = new fdir()
			.withBasePath()
			.exclude((dir) => dir === 'node_modules')
			.glob(...args['from-glob']!)
			.crawl();
		// eslint-disable-next-line no-console
		console.log(
			`Finding files matching ${args['from-glob']!.map((glob) => `'${glob}'`).join(', ')}...`,
		);
		for (const file of await api.withPromise()) {
			process.stdout.write(`- ${file} `);
			const code = await readFile(file, 'utf-8').catch(() => null);
			if (code === null) continue;
			let ast: Program;
			try {
				ast = parseSync(file, code).program;
			} catch (_) {
				// eslint-disable-next-line no-console
				console.log();
				continue;
			}
			const import_name = find_import(ast, generator.config.moduleId!);
			if (!import_name) {
				// eslint-disable-next-line no-console
				console.log();
				continue;
			}
			// eslint-disable-next-line no-console
			console.log('✓');
			generator.files.set(file, {
				ast,
				import_name,
			});
		}
	}
	// eslint-disable-next-line no-console
	const schema = await load_schema(generator.config, console.warn);

	const file_map = new Map<string, TypeMap>();

	for (const [file, { ast, import_name }] of generator.files) {
		const types = walk_ast(
			{
				ast,
				schema,
				custom_scalars: generator.config.customScalars,
				import_name,
				throw_gql_errors: true,
				magic_string: undefined,
			},
			{
				warn(warning) {
					// eslint-disable-next-line no-console
					console.warn(warning);
				},
				error(err) {
					throw err;
				},
			},
		);
		file_map.set(file, types);
	}

	await write_dts_file(file_map, generator.config.moduleId!, out_file);
	// eslint-disable-next-line no-console
	console.log('Types written to', args['out-file'] ?? generator.config.outFile);
}

cli();
