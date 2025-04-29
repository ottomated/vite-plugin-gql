declare module '$gql' {
	export default function gql(
		query: "\n\tquery {\n\t\tallFilms {\n\t\t\tfilms {\n\t\t\t\ttitle\n\t\t\t}\n\t\t}\n\t}\n",
		variables: {}
	): Promise<(({"films": (Array<({"title": (string) | null,})>) | null,}) | null)>;
	export default function gql(
		query: string,
		variables: unknown
	): Promise<unknown>;
}
