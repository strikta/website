import javascript from '@eslint/js';
import { defineConfig } from 'eslint/config';
import astro from 'eslint-plugin-astro';
import globals from 'globals';
import typescript from 'typescript-eslint';

const typeWord = '(?:bool|bytes|dict|float|integer|int|list|set|string|str|tuple)';
const capitalised = typeWord.replace(/\b([a-z])/gu, (letter) => letter.toUpperCase());
const anyTypeWord = `(?:^|_)${typeWord}(?=$|_|[A-Z0-9])|(?<=[a-z0-9]|^|_)(?:${capitalised})(?=$|_|[A-Z0-9])`;
const positional = 'Positional indexing is banned: destructure the value or use a named object.';

const structure = [
	{ selector: 'ImportExpression', message: 'Imports belong at the top of the module.' },
	{ selector: 'ClassDeclaration, ClassExpression', message: 'Use types, plain objects and functions.' },
	{ selector: "MemberExpression[computed=true][property.type='Literal'][property.raw=/^\\d+$/]", message: positional },
	{ selector: "CallExpression[callee.property.name='at'][arguments.0.type=/^(Literal|UnaryExpression)$/]", message: positional }
];
const thirdParty = { selector: "Literal[value=/https?:\\/\\/(?!strikta\\.dev|github\\.com\\/strikta)/]", message: 'No third-party URL in code: see AGENTS.md, "Hard boundaries".' };

/** @type {import('eslint').Linter.RulesRecord} */
/** @type {import('eslint').Linter.RulesRecord} */
const house = {
	'no-restricted-syntax': ['error', ...structure, thirdParty],
	'no-console': 'error',
	'id-denylist': ['error', 'result', 'results'],
	'id-length': ['error', { min: 3, properties: 'never' }],
	'max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true }],
	'@typescript-eslint/naming-convention': [
		'error',
		{ selector: 'default', format: null, leadingUnderscore: 'forbid', trailingUnderscore: 'forbid', custom: { regex: anyTypeWord, match: false } },
		{ selector: ['objectLiteralProperty', 'typeProperty'], format: null }
	]
};

export default defineConfig(
	{ ignores: ['dist/', '.astro/', 'node_modules/', 'content/export/', '.cache/', 'test-results/', 'playwright-report/'] },
	javascript.configs.recommended,
	typescript.configs.strictTypeChecked,
	astro.configs.recommended,
	{
		linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' },
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname, extraFileExtensions: ['.astro'] }
		},
		rules: {
			...house,
			'@typescript-eslint/explicit-function-return-type': 'error',
			'@typescript-eslint/explicit-module-boundary-types': 'error',
			'@typescript-eslint/prefer-destructuring': ['error', { array: true, object: true }]
		}
	},
	{ files: ['tool/**'], rules: { 'no-restricted-syntax': ['error', ...structure] } },
	{ files: ['**/*.js'], rules: { '@typescript-eslint/explicit-function-return-type': 'off', '@typescript-eslint/explicit-module-boundary-types': 'off' } }
);
