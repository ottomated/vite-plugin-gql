import { defineConfig } from 'tsdown';
import { resolve } from 'node:path';
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
				handler(id, importer) {
					if (!id.endsWith('?raw')) return;
					id = id.slice(0, -4);

					if (importer && id.startsWith('.')) {
						return RAW_PREFIX + resolve(importer, '..', id);
					} else {
						return RAW_PREFIX + resolve(process.cwd(), id);
					}
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
