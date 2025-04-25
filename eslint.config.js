import globals from 'globals';
import js from '@eslint/js';
import ts from 'typescript-eslint';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.es2017,
			},
		},
	},
	{
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			'@typescript-eslint/naming-convention': [
				'error',
				{
					selector: 'variableLike',
					format: ['snake_case'],
					trailingUnderscore: 'allow',
				},
				{
					selector: 'variable',
					modifiers: ['destructured'],
					format: null,
				},
				{
					selector: 'variable',
					modifiers: ['const', 'global'],
					format: ['UPPER_CASE', 'snake_case'],
				},
			],
		},
	},
	{ ignores: ['**/.svelte-kit', 'build/', 'dist/'] },
);
