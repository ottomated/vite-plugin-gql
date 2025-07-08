import gql from '$gql';
(async () => {
	console.log(
		await gql(/* GraphQL */ `
			query {
				allFilms {
					films {
						id
					}
				}
			}
		`),
	);
	await gql(
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
})();
