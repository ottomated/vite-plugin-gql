/* global GQL_URL, GQL_HEADERS */

export default async function gql(query, variables) {
	const variables_body = variables
		? `,"variables":${JSON.stringify(variables)}`
		: '';
	const response = await fetch(GQL_URL, {
		method: 'POST',
		headers: GQL_HEADERS,
		body: `{"query":${query}${variables_body}}`,
	});
	if (!response.ok) {
		throw new Error(
			`GQL error: ${response.statusText} ${await response.text()}`,
		);
	}
	return response.json();
}
