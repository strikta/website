import { expect, test } from 'vitest';
import { separated } from './shell.ts';

test.each([
	'ls; pwd',
	'ls ;pwd',
	'echo "a" ; echo b',
	"echo 'a';echo b",
	'cd somewhere; ls',
	'echo "a\\" ; b"; ls',
	'echo $(ls; pwd)',
	'cat <<EOF\nbody\nEOF\nls; pwd',
	"echo 'open",
	'echo "open',
	"echo $'open",
	'cat <<EOF\nnever closed; at all',
	'cat <<EOF',
	'cat <<',
	'for name in a b; do echo $name; done'
])('blocks %j', (command) => {
	expect(separated(command)).toBe(true);
});

test.each([
	'npm run lint && npm run check',
	'git commit -m "Keep a; b apart"',
	"git commit -m 'Keep a; b apart'",
	"echo $'tab\\t; inside'",
	'echo a\\;b',
	'find . -name "*.ts" -exec ls {} \\;',
	'echo a # comment; not a separator',
	'cat <<EOF\nline; with separator\nEOF',
	"cat <<'EOF' > note.md\nquoted; delimiter\nEOF",
	'cat <<-EOF\n\tstripped; body\n\tEOF',
	'cat <<"END"\none; two\nEND\necho done',
	'grep -c x <<< "a; b"',
	'echo a#b',
	''
])('allows %j', (command) => {
	expect(separated(command)).toBe(false);
});
