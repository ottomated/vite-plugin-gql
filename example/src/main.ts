import './file2';
import gql from '$gql';
(async () => {
	console.log(
		await gql(/* GraphQL */ `
			query {
				allFilms {
					films {
						title
						director
					}
				}
			}
		`),
	);

	const data = await gql(
		/* GraphQL */ `
			query ($id: ID!) {
				starship(id: $id) {
					name
					id
				}
			}
		`,
		{ id: 'c3RhcnNoaXBzOjEw' },
	);
	console.log(data);
})();
