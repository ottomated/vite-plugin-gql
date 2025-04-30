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
})();
