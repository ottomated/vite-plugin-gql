import { defineConfig } from 'vite';
import gqlPlugin from '@o7/vite-plugin-gql';
import inspect from 'vite-plugin-inspect';

export default defineConfig({
	plugins: [
		gqlPlugin({
			url: 'https://swapi-graphql.netlify.app/graphql',
			outFile: 'src/gql.d.ts',
		}),
		inspect(),
	],
});
