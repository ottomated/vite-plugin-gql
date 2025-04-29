import gql from '$gql';

const res = await gql(/* GraphQL */ `
	query {
		allFilms {
			films {
				title
			}
		}
	}
`);

console.log(res);
