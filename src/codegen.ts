import type {
	ASTNode,
	GraphQLSchema,
	GraphQLType,
	SelectionSetNode,
	SourceLocation,
	VariableDefinitionNode,
} from 'graphql';
import {
	GraphQLError,
	isEnumType,
	isInputObjectType,
	isInterfaceType,
	isListType,
	isNonNullType,
	isObjectType,
	isScalarType,
	isUnionType,
	parse,
	typeFromAST,
} from 'graphql';

export const SCALAR_TYPES = {
	Int: 'number',
	Float: 'number',
	String: 'string',
	Boolean: 'boolean',
	ID: 'string',
	URL: 'string',
	Decimal: 'number',
} as Record<string, string>;

export function generate_typescript(
	query: string,
	schema: GraphQLSchema,
	custom_scalars: Record<string, string> | undefined,
): {
	variables: string | null;
	return_type: string;
} {
	const ast = parse(query);
	if (ast.definitions.length > 1) {
		throw new GraphQLError(
			`Expected a single query, got ${ast.definitions.length}`,
			{
				nodes: [ast.definitions[1]!],
			},
		);
	}
	if (ast.definitions.length === 0) {
		throw new Error('Expected a query');
	}
	const definition = ast.definitions[0]!;
	if (definition.kind !== 'OperationDefinition') {
		throw new GraphQLError(`Expected an operation, got ${definition.kind}`, {
			nodes: [definition],
		});
	}
	const root = schema.getRootType(definition.operation);
	if (!root) {
		throw new GraphQLError(
			`Schema doesn't contain any ${definition.operation} operations`,
			{
				nodes: [definition],
			},
		);
	}
	const scalar_types = custom_scalars
		? { ...SCALAR_TYPES, ...custom_scalars }
		: SCALAR_TYPES;
	return {
		variables: generate_variable_types(
			definition.variableDefinitions,
			schema,
			scalar_types,
		),
		return_type: generate_selected_type(definition, root, schema, scalar_types),
	};
	// return generate_typedef(selection, operation.type, schema);
}

function generate_variable_types(
	variables: readonly VariableDefinitionNode[] | undefined,
	schema: GraphQLSchema,
	scalar_types: Record<string, string>,
): string | null {
	if (!variables || !variables.length) return null;
	return (
		'{' +
		variables.map((v) => {
			const type = typeFromAST(schema, v.type);
			const typescript = type
				? generate_selected_type(v.type, type, schema, scalar_types)
				: 'unknown';

			return `${v.variable.name.value}: ${typescript}`;
		}) +
		'}'
	);
}

function generate_selected_type(
	node: ASTNode & { selectionSet?: SelectionSetNode },
	type: GraphQLType,
	schema: GraphQLSchema,
	scalar_types: Record<string, string>,
): string {
	if (isListType(type)) {
		return `(Array<${generate_selected_type(node, type.ofType, schema, scalar_types)}>) | null | undefined`;
	}
	if (isNonNullType(type)) {
		const sub_type = generate_selected_type(
			node,
			type.ofType,
			schema,
			scalar_types,
		);
		if (is_null_type(sub_type)) {
			return sub_type.slice(1, -20);
		}
		return sub_type;
	}
	const selections = node.selectionSet?.selections ?? [];

	let typescript: string;

	if (isObjectType(type) || isInterfaceType(type)) {
		const fields = type.getFields();
		typescript = '{';
		for (const field of selections) {
			if (field.kind !== 'Field')
				throw new GraphQLError(`Expected a field, got ${field.kind}`, {
					nodes: [field],
				});
			const type_field = fields[field.name.value];
			if (!type_field) {
				throw new GraphQLError(
					`Property '${field.name.value}' does not exist on type ${type.name}`,
					{
						nodes: [field],
					},
				);
			}
			const typescript_type = generate_selected_type(
				field,
				type_field.type,
				schema,
				scalar_types,
			);
			typescript += `${JSON.stringify(field.name.value)}${is_null_type(typescript_type) ? '?' : ''}: ${typescript_type},`;
		}
		typescript += '}';
	} else if (isUnionType(type)) {
		const objects: Array<string> = [];
		for (const field of selections) {
			if (field.kind !== 'InlineFragment') {
				throw new GraphQLError(
					`Expected an inline fragment, got ${field.kind}`,
					{
						nodes: [field],
					},
				);
			}
			const union_member = type
				.getTypes()
				.find((t) => t.name === field.typeCondition?.name.value);
			if (!union_member) {
				throw new GraphQLError(
					`Union type '${type.name}' does not contain member '${field.typeCondition?.name.value}'`,
					{
						nodes: [field],
					},
				);
			}
			objects.push(
				`(${generate_selected_type(field, union_member, schema, scalar_types)})`,
			);
		}
		typescript = objects.join(' | ');
	} else if (isEnumType(type)) {
		typescript = type
			.getValues()
			.map((v) => JSON.stringify(v.name))
			.join(' | ');
	} else if (isScalarType(type)) {
		if (type.name in scalar_types) {
			typescript = scalar_types[type.name]!;
		} else {
			throw new GraphQLError(
				`Unknown scalar type '${type.name}' (add it to the 'customScalars' option in your vite config)`,
				{
					nodes: [node],
				},
			);
		}
	} else if (isInputObjectType(type)) {
		// Select all fields on an input object
		const fields = type.getFields();
		typescript = '{';
		for (const [name, field] of Object.entries(fields)) {
			const typescript_type = generate_selected_type(
				node,
				field.type,
				schema,
				scalar_types,
			);
			typescript += `${JSON.stringify(name)}${is_null_type(typescript_type) ? '?' : ''}: ${typescript_type},`;
		}
		typescript += '}';
	} else {
		throw new GraphQLError(`Unknown type '${type}'`, {
			nodes: [node],
		});
	}
	return `(${typescript}) | null | undefined`;
}

function is_null_type(type: string): boolean {
	return type.startsWith('(') && type.endsWith(') | null | undefined');
}

export function location_to_index(
	location: SourceLocation,
	code: string,
): number {
	const lines = code.split('\n');
	let index = 0;
	for (let i = 0; i < location.line - 1; i++) {
		index += lines[i]!.length + 1;
	}
	return index + location.column;
}
