import { defineConfig } from 'vite';
import vitePluginGqlTag from 'vite-plugin-gql-tag';
import inspect from 'vite-plugin-inspect';

export default defineConfig({
	plugins: [
		vitePluginGqlTag({
			headers: {},
			url: 'https://swapi-graphql.netlify.app/graphql',
			outFile: 'src/gql.d.ts',
		}),
		inspect(),
	],
});
