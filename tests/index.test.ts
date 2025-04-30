/// <reference types="@types/bun" />
import { test, expect } from 'bun:test';
import { generate_typescript } from '../src/codegen';
import { loadSchema } from '@graphql-tools/load';
import { format } from 'prettier';

const schema = await loadSchema(
	/* GraphQL */ `
		schema {
			query: QueryRoot
			mutation: Mutation
		}
		type QueryRoot {
			list: ListResult
			get(id: ID!): GetResult
		}
		type Mutation {
			create(input: CreateInput!): GetResult!
		}

		input CreateInput {
			name: String!
			numbers: [Int!]
		}

		interface Node {
			id: ID!
		}

		type GetResult implements Node {
			id: ID!
			name: String!
			numbers: [Int!]
		}

		type ListResult {
			items: [GetResult]
		}
	`,
	{
		loaders: [],
	},
);

const cases = [
	/* GraphQL */ `
		query {
			list {
				items {
					id
					name
					numbers
				}
			}
		}
	`,
	/* GraphQL */ `
		query ($id: ID!) {
			get(id: $id) {
				id
				name
				numbers
			}
		}
	`,
	/* GraphQL */ `
		mutation ($input: CreateInput!) {
			create(input: $input) {
				id
				name
			}
		}
	`,
];

test.each(cases)('gql %#', async (query) => {
	const res = generate_typescript(query, schema, undefined);
	const variables = await format('type In = ' + res.variables, {
		parser: 'typescript',
	});
	expect(variables).toMatchSnapshot();
	const return_type = await format('type Out = ' + res.return_type, {
		parser: 'typescript',
	});
	expect(return_type).toMatchSnapshot();
});
