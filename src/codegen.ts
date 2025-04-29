import type {
	ASTNode,
	GraphQLList,
	GraphQLNonNull,
	GraphQLSchema,
	GraphQLType,
	SelectionSetNode,
	SourceLocation,
	VariableDefinitionNode,
} from 'graphql';
import {
	GraphQLError,
	isEnumType,
	isInterfaceType,
	isListType,
	isNonNullType,
	isObjectType,
	isScalarType,
	isUnionType,
	parse,
	typeFromAST,
} from 'graphql';

const SCALAR_TYPES = {
	ID: 'string',
	URL: 'string',
	Int: 'number',
	Float: 'number',
	Decimal: 'number',
	String: 'string',
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
	const type_info = get_type_info(type);
	const selections = node.selectionSet?.selections ?? [];

	let typescript: string;

	if (isObjectType(type_info.type) || isInterfaceType(type_info.type)) {
		const fields = type_info.type.getFields();
		typescript = '{';
		for (const field of selections) {
			if (field.kind !== 'Field')
				throw new GraphQLError(`Expected a field, got ${field.kind}`, {
					nodes: [field],
				});
			const type_field = fields[field.name.value];
			if (!type_field) {
				throw new GraphQLError(
					`Property '${field.name.value}' does not exist on type ${type_info.type.name}`,
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
			typescript += `${JSON.stringify(field.name.value)}: ${typescript_type},`;
		}
		typescript += '}';
	} else if (isUnionType(type_info.type)) {
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
			const union_member = type_info.type
				.getTypes()
				.find((t) => t.name === field.typeCondition?.name.value);
			if (!union_member) {
				throw new GraphQLError(
					`Union type '${type_info.type.name}' does not contain member '${field.typeCondition?.name.value}'`,
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
	} else if (isEnumType(type_info.type)) {
		typescript = type_info.type
			.getValues()
			.map((v) => JSON.stringify(v.name))
			.join(' | ');
	} else if (isScalarType(type_info.type)) {
		if (type_info.type.name in scalar_types) {
			typescript = scalar_types[type_info.type.name]!;
		} else {
			throw new GraphQLError(
				`Unknown scalar type '${type_info.type.name}' (add it to the 'customScalars' option in your vite config)`,
				{
					nodes: [node],
				},
			);
		}
	} else {
		throw new GraphQLError(`Unknown type '${type_info.type}'`, {
			nodes: [node],
		});
	}

	if (type_info.array) {
		typescript = `Array<(${typescript})>`;
	}
	if (type_info.nullable) {
		typescript = `(${typescript}) | null`;
	}
	return typescript;
}

function get_type_info(type_node: GraphQLType): {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type: Exclude<GraphQLType, GraphQLList<any> | GraphQLNonNull<any>>;
	array: boolean;
	nullable: boolean;
} {
	if (isListType(type_node)) {
		const of = get_type_info(type_node.ofType);
		return {
			type: of.type,
			array: true,
			nullable: of.nullable,
		};
	}
	if (isNonNullType(type_node)) {
		const of = get_type_info(type_node.ofType);
		return {
			type: of.type,
			array: of.array,
			nullable: false,
		};
	}
	return {
		type: type_node,
		array: false,
		nullable: true,
	};
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
