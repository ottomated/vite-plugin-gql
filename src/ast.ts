import type { Node } from 'estree';
import { walk } from 'zimmerframe';

export function find_import(ast: Node, module_id: string): string | null {
	let import_name: string | null = null;
	walk(
		ast,
		{},
		{
			ImportDeclaration(node, { stop }) {
				if (node.source.value !== module_id) return;
				const specifier = node.specifiers.find(
					(s) => s.type === 'ImportDefaultSpecifier',
				);
				if (!specifier) return;
				import_name = specifier.local.name;
				stop();
			},
		},
	);
	return import_name;
}
