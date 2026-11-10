import { expect, test } from 'vitest';
import { enquiry, header, legal, stagedLinks } from './navigation.ts';

const SPECIFIED_ENQUIRY =
	'mailto:licensing@strikta.dev?subject=Company%20licence%20enquiry&body=Company%20legal%20name%3A%0ARegistration%20number%3A%0AVAT%20number%3A%0ACountry%3A%0AAddress%3A%0AContact%20for%20notices%20(name%2C%20email)%3A%0A%0AProduct%20name%3A%0AWhat%20the%20product%20does%3A%0AUse%20(keep%20one)%3A%20distributed%20to%20end%20users%20%2F%20run%20as%20a%20hosted%20service%20%2F%20both%0ARevenue%20band%20of%20your%20group%20(keep%20one)%3A%20under%20%E2%82%AC1M%20%2F%20%E2%82%AC1M%E2%80%93%E2%82%AC10M%20%2F%20over%20%E2%82%AC10M%0AWhat%20you%20need%20(start%20date%2C%20questions)%3A%0A';

test('the company-licence enquiry is the specified mailto, byte for byte', () => {
	expect(enquiry).toBe(SPECIFIED_ENQUIRY);
});

test('links to pages the current stage does not build are left out', () => {
	const routes = stagedLinks(header).map((link) => link.route);
	expect(routes).toContain('/pro');
	expect(routes).not.toContain('/docs');
	expect(routes).not.toContain('/head-to-head');
	expect(stagedLinks(legal).map((link) => link.route)).not.toContain('/legal/support-period');
});

test('the refund policy is the only staged legal text published as a draft', () => {
	const drafts = stagedLinks(legal).filter((link) => link.draft).map((link) => link.route);
	expect(drafts).toEqual(['/legal/refund-policy']);
});
