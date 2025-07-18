import { defineConfig } from 'tsdown';
import { readFile } from 'node:fs/promises';

const RAW_PREFIX = '\0raw:';

export default defineConfig({
	entry: ['./src/index.ts'],
	target: 'node20.18',
	clean: true,
	dts: true,
	external: ['node:fs/promises', 'rollup', 'node:path'],
	platform: 'neutral',
	plugins: [
		{
			name: 'raw',
			resolveId: {
				filter: {
					id: /\?raw$/,
				},
				async handler(id, importer) {
					if (!id.endsWith('?raw')) return;
					const resolved = await this.resolve(id.slice(0, -4), importer);
					if (!resolved) return null;
					return RAW_PREFIX + resolved.id;
				},
			},
			load: {
				filter: {
					id: /^\0raw:/,
				},
				async handler(id) {
					const contents = await readFile(
						id.substring(RAW_PREFIX.length),
						'utf-8',
					);
					return `export default ${JSON.stringify(contents)};`;
				},
			},
		},
	],
});
