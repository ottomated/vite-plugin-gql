/// <reference types="@types/bun" />
import { test, expect } from 'bun:test';
import { generate_typescript } from '../src/codegen';
import { loadSchema } from '@graphql-tools/load';
import { UrlLoader } from '@graphql-tools/url-loader';
import { format } from 'prettier';

const schema = await loadSchema('https://swapi-graphql.netlify.app/graphql', {
	loaders: [new UrlLoader()],
});
test('simple', async () => {
	const query = /* GraphQL */ `
		query {
			allFilms {
				films {
					title
					director
				}
			}
		}
	`;
	const res = generate_typescript(query, schema, undefined);
	expect(res.variables).toBe(null);
	const return_type = await format(res.return_type, { parser: 'typescript' });
	expect(return_type).toBe(`({
  allFilms:
    { films: Array<{ title: string | null; director: string | null }> | null } |
    null,
}) | null;\n`);
});

test('variables', async () => {
	const query = /* GraphQL */ `
		query ($id: ID!) {
			starship(id: $id) {
				name
				id
			}
		}
	`;
	const res = generate_typescript(query, schema, undefined);
	expect(res.variables).toBe(`{id: string}`);
	const return_type = await format(res.return_type, { parser: 'typescript' });
	expect(return_type).toBe(
		`({ starship: { name: string | null, id: string } | null }) | null;\n`,
	);
});
