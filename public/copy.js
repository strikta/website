// Shows each copy button, copies the code beside it and announces the outcome in the status line beside it.
for (const button of document.querySelectorAll('button[data-copy]')) {
	if (!(button instanceof HTMLButtonElement)) {
		continue;
	}
	const code = button.parentElement?.querySelector('code');
	const status = button.parentElement?.querySelector('[data-copy-status]');
	if (code !== null && code !== undefined && status !== null && status !== undefined && 'clipboard' in navigator) {
		button.hidden = false;
		/** @param {string} outcome */
		const report = (outcome) => {
			button.textContent = outcome;
			status.textContent = outcome;
		};
		button.addEventListener('click', () => {
			navigator.clipboard.writeText(code.textContent).then(() => {
				report('Copied');
			}, () => {
				report('Copy failed');
			});
		});
	}
}
