import { loadSchema, type LoadSchemaOptions } from '@graphql-tools/load';
import { UrlLoader } from '@graphql-tools/url-loader';
import type { GraphQLSchema } from 'graphql';
import type { WatchSchemaConfig } from './index';

export class SchemaWatcher {
	private config: WatchSchemaConfig;
	private schemaOptions?: Omit<LoadSchemaOptions, 'loaders' | 'headers'>;
	private onSchemaChange: (schema: GraphQLSchema) => void;
	private onError: (error: Error) => void;
	private currentSchema: GraphQLSchema | null = null;
	private intervalId: NodeJS.Timeout | null = null;

	constructor(
		config: WatchSchemaConfig,
		schemaOptions: Omit<LoadSchemaOptions, 'loaders' | 'headers'> | undefined,
		onSchemaChange: (schema: GraphQLSchema) => void,
		onError: (error: Error) => void
	) {
		this.config = config;
		this.schemaOptions = schemaOptions;
		this.onSchemaChange = onSchemaChange;
		this.onError = onError;
	}

	async startPolling(): Promise<void> {
		try {
			await this.loadAndUpdateSchema();
		} catch (error) {
			this.onError(error instanceof Error ? error : new Error(String(error)));
		}

		if (this.config.interval && this.config.interval > 0) {
			this.intervalId = setInterval(async () => {
				try {
					await this.loadAndUpdateSchema();
				} catch (error) {
					this.onError(error instanceof Error ? error : new Error(String(error)));
				}
			}, this.config.interval);
		}
	}

	stopPolling(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	getCurrentSchema(): GraphQLSchema | null {
		return this.currentSchema;
	}

	private async loadAndUpdateSchema(): Promise<void> {
		const env = process.env;
		const url = typeof this.config.url === 'function' ? this.config.url(env) : this.config.url;
		
		let headers: Record<string, string> = {};
		if (this.config.headers) {
			if (typeof this.config.headers === 'function') {
				headers = this.config.headers(env);
			} else {
				for (const [key, value] of Object.entries(this.config.headers)) {
					if (typeof value === 'function') {
						headers[key] = value(env);
					} else {
						headers[key] = value;
					}
				}
			}
		}

		const controller = new AbortController();
		const timeoutId = this.config.timeout 
			? setTimeout(() => controller.abort(), this.config.timeout)
			: null;

		try {
			const schema = await loadSchema(url, {
				...this.schemaOptions,
				headers,
				loaders: [new UrlLoader()],
			});

			this.currentSchema = schema;
			this.onSchemaChange(schema);
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		}
	}
}