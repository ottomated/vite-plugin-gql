import {
	type EnumTypeDefinitionNode,
	type FieldNode,
	GraphQLSchema,
	type InlineFragmentNode,
	type InterfaceTypeDefinitionNode,
	type ObjectTypeDefinitionNode,
	parse,
	type ScalarTypeDefinitionNode,
	type TypeNode,
	type UnionTypeDefinitionNode,
} from 'graphql';

const TOP_LEVEL_NODES = [
	'ObjectTypeDefinition',
	'InterfaceTypeDefinition',
	'UnionTypeDefinition',
	'ScalarTypeDefinition',
	'EnumTypeDefinition',
];

const BASE_TYPES = {
	ID: 'string',
	URL: 'string',
	Int: 'number',
	Float: 'number',
	Decimal: 'number',
	String: 'string',
} as Record<string, string>;

interface Schema {
	roots: {
		query?: ObjectTypeDefinitionNode;
		mutation?: ObjectTypeDefinitionNode;
		subscription?: undefined;
	};
	types: Map<
		string,
		| ObjectTypeDefinitionNode
		| InterfaceTypeDefinitionNode
		| UnionTypeDefinitionNode
		| ScalarTypeDefinitionNode
		| EnumTypeDefinitionNode
	>;
}
export function parse_schema(schema_ast: GraphQLSchema): Schema {
	const schema: Schema = {
		roots: {},
		types: new Map(),
	};
	for (const def of schema_ast.astNode.definitions) {
		if (!('name' in def)) continue;
		if (def.kind === 'ObjectTypeDefinition' && def.name.value === 'QueryRoot') {
			schema.roots.query = def;
			continue;
		}
		if (def.kind === 'ObjectTypeDefinition' && def.name.value === 'Mutation') {
			schema.roots.mutation = def;
			continue;
		}
		if (!TOP_LEVEL_NODES.includes(def.kind) || !def.name) {
			continue;
		}
		schema.types.set(
			def.name.value,
			def as unknown as ObjectTypeDefinitionNode,
		);
	}
	return schema;
}

export function generate_typescript(query: string, schema: Schema): string {
	const ast = parse(query, { noLocation: true });
	if (ast.definitions.length !== 1) {
		throw new Error('Expected a single query');
	}
	const definition = ast.definitions[0]!;
	if (definition.kind !== 'OperationDefinition') {
		throw new Error('Expected an operation definition');
	}
	const root = schema.roots[definition.operation];
	if (!root) {
		throw new Error(`No root for ${definition.operation} on schema`);
	}
	const selection = definition.selectionSet.selections[0];
	if (!selection || selection.kind !== 'Field') {
		throw new Error('Expected a selection field');
	}
	const fn = root.fields?.find((f) => f.name.value === selection.name.value);
	if (!fn) {
		throw new Error(`No function for ${selection.name.value} on schema`);
	}
	console.log(fn);
	return generate_typedef(selection, fn.type, schema);
}

function get_type_info(type_node: TypeNode): {
	name: string;
	array: boolean;
	nullable: boolean;
} {
	switch (type_node.kind) {
		case 'NamedType':
			return {
				name: type_node.name.value,
				array: false,
				nullable: true,
			};
		case 'NonNullType': {
			const t = get_type_info(type_node.type);
			return {
				name: t.name,
				array: t.array,
				nullable: false,
			};
		}
		case 'ListType': {
			const t = get_type_info(type_node.type);
			return {
				name: t.name,
				array: true,
				nullable: t.nullable,
			};
		}
		default:
			throw new Error(`Unknown type ${type_node.kind}`);
	}
}

function generate_typedef(
	node: FieldNode | InlineFragmentNode,
	type_node: TypeNode,
	schema: Schema,
): string {
	const type_info = get_type_info(type_node);

	if (type_info.name in BASE_TYPES) {
		return BASE_TYPES[type_info.name]!;
	}
	const type = schema.types.get(type_info.name);
	if (!type) {
		throw new Error(`No type for ${type_info.name}`);
	}
	let obj: string;
	switch (type.kind) {
		case 'ObjectTypeDefinition':
		case 'InterfaceTypeDefinition':
			obj = '{';
			for (const field of node.selectionSet?.selections ?? []) {
				if (field.kind !== 'Field') throw new Error('Expected a field');
				const type_field = type.fields?.find(
					(f) => f.name.value === field.name.value,
				);
				if (!type_field) {
					throw new Error(`No field for ${field.name.value}`);
				}

				obj += `${JSON.stringify(field.name.value)}: ${generate_typedef(field, type_field.type, schema)},`;
				// get the field on the type
				// log(`${field.name.value}: ${generate_typedef(field, type_field.type)}`);
			}
			obj += '}';
			break;
		case 'EnumTypeDefinition':
			obj = (type.values ?? []).map((v) => `"${v.name.value}"`).join(' | ');
			break;
		case 'UnionTypeDefinition': {
			const objs: string[] = [];
			for (const field of node.selectionSet?.selections ?? []) {
				if (field.kind !== 'InlineFragment')
					throw new Error('Expected an inline fragment');
				const union_member = type.types?.find(
					(m) => m.name.value === field.typeCondition?.name.value,
				);
				if (!union_member)
					throw new Error(`No member for ${field.typeCondition?.name.value}`);
				objs.push(generate_typedef(field, union_member, schema));
				// objs.push(generate_typedef(field, union_member));
			}

			obj = objs.map((o) => `(${o})`).join(' | ');
			break;
		}
		default:
			throw new Error(`${type.kind} types not supported`);
	}

	if (type_info.array) {
		obj = `Array<(${obj})>`;
	}
	if (type_info.nullable) {
		obj = `(${obj}) | null`;
	}
	return obj;
}
