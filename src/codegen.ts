import type {
	GraphQLList,
	GraphQLNonNull,
	GraphQLSchema,
	GraphQLType,
	SelectionSetNode,
	VariableDefinitionNode,
} from 'graphql';
import {
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

const BASE_TYPES = {
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
): {
	variables: string;
	return_type: string;
} {
	const ast = parse(query, { noLocation: true });
	if (ast.definitions.length !== 1) {
		throw new Error('Expected a single query');
	}
	const definition = ast.definitions[0]!;
	if (definition.kind !== 'OperationDefinition') {
		throw new Error('Expected an operation definition');
	}
	const root = schema.getRootType(definition.operation);
	if (!root) {
		throw new Error(`No root for ${definition.operation} on schema`);
	}
	const selection = definition.selectionSet.selections[0];
	if (!selection || selection.kind !== 'Field') {
		throw new Error('Expected a selection field');
	}
	const operation = root.getFields()[selection.name.value];
	// .fields?.find((f) => f.name.value === selection.name.value);
	if (!operation) {
		throw new Error(
			`Operation "${selection.name.value}" (${definition.operation}) not found`,
		);
	}
	return {
		variables: generate_variable_types(definition.variableDefinitions, schema),
		return_type: generate_selected_type(selection, operation.type, schema),
	};
	// return generate_typedef(selection, operation.type, schema);
}

function generate_variable_types(
	variables: readonly VariableDefinitionNode[] | undefined,
	schema: GraphQLSchema,
): string {
	if (!variables) return 'undefined';
	return (
		'{' +
		variables?.map((v) => {
			const type = typeFromAST(schema, v.type);
			const typescript = type
				? generate_selected_type({}, type, schema)
				: 'unknown';

			return `${v.variable.name.value}: ${typescript}`;
		}) +
		'}'
	);
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

function generate_selected_type(
	node: { selectionSet?: SelectionSetNode },
	type: GraphQLType,
	schema: GraphQLSchema,
): string {
	const type_info = get_type_info(type);
	const selections = node.selectionSet?.selections ?? [];

	let typescript: string;

	if (isObjectType(type_info.type) || isInterfaceType(type_info.type)) {
		const fields = type_info.type.getFields();
		typescript = '{';
		for (const field of selections) {
			if (field.kind !== 'Field') throw new Error('Expected a field');
			const type_field = fields[field.name.value];
			if (!type_field) {
				throw new Error(`No field for ${field.name.value}`);
			}
			const typescript_type = generate_selected_type(
				field,
				type_field.type,
				schema,
			);
			typescript += `${JSON.stringify(field.name.value)}: ${typescript_type},`;
		}
		typescript += '}';
	} else if (isUnionType(type_info.type)) {
		const objects: Array<string> = [];
		for (const field of selections) {
			if (field.kind !== 'InlineFragment')
				throw new Error('Expected an inline fragment');
			const union_member = type_info.type
				.getTypes()
				.find((t) => t.name === field.typeCondition?.name.value);
			if (!union_member)
				throw new Error(`No member for ${field.typeCondition?.name.value}`);
			objects.push(`(${generate_selected_type(field, union_member, schema)})`);
		}
		typescript = objects.join(' | ');
	} else if (isEnumType(type_info.type)) {
		typescript = type_info.type
			.getValues()
			.map((v) => JSON.stringify(v.name))
			.join(' | ');
	} else if (isScalarType(type_info.type)) {
		if (type_info.type.name in BASE_TYPES) {
			typescript = BASE_TYPES[type_info.type.name]!;
		} else {
			throw new Error(`Unknown scalar ${type_info.type.name}`);
		}
	} else {
		throw new Error(`Unknown type ${type_info.type}`);
	}

	if (type_info.array) {
		typescript = `Array<(${typescript})>`;
	}
	if (type_info.nullable) {
		typescript = `(${typescript}) | null`;
	}
	return typescript;
}
