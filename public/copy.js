// Shows each copy button and copies the code beside it.
for (const button of document.querySelectorAll('button[data-copy]')) {
	if (!(button instanceof HTMLButtonElement)) {
		continue;
	}
	const code = button.parentElement?.querySelector('code');
	if (code !== null && code !== undefined && 'clipboard' in navigator) {
		button.hidden = false;
		button.addEventListener('click', () => {
			navigator.clipboard.writeText(code.textContent).then(() => {
				button.textContent = 'Copied';
			}, () => {
				button.textContent = 'Copy failed';
			});
		});
	}
}
