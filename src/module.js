let default_url = GQL_URL;
let default_headers = GQL_HEADERS;

class LazyPromise extends Promise {
	#executor;
	#promise;
	constructor(executor) {
		super((r) => r());
		this.#executor = executor;
	}
	then() {
		this.#promise ??= new Promise(this.#executor);
		return this.#promise.then.apply(this.#promise, arguments);
	}
}

export default function gql(query, variables) {
	const variables_body = variables
		? `,"variables":${JSON.stringify(variables)}`
		: '';
	let override = undefined;
	const promise = new LazyPromise(async (resolve, reject) => {
		try {
			const response = await fetch(override?.url ?? default_url, {
				method: 'POST',
				headers: override?.headers ?? default_headers,
				body: `{"query":${query}${variables_body}}`,
			});
			if (!response.ok) {
				throw new Error(
					`GQL error: ${response.statusText} ${await response.text()}`,
				);
			}
			resolve(await response.json());
		} catch (e) {
			reject(e);
		}
	});
	Object.defineProperty(promise, 'with', {
		value: (o) => {
			override = o;
			return promise;
		},
	});
	return promise;
}

/* global GQL_URL, GQL_HEADERS */
