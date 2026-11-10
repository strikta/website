import { staged } from './stage.ts';

/** A link to a page of the site; it is shown only while the current stage builds its page. */
export type Link = { readonly route: string; readonly label: string };
/** A legal page and the exported text it renders. */
export type LegalPage = Link & { readonly file: string; readonly draft: boolean };

const ENQUIRY_SUBJECT = 'Company licence enquiry';
const ENQUIRY_FIELDS = [
	'Company legal name:',
	'Registration number:',
	'VAT number:',
	'Country:',
	'Address:',
	'Contact for notices (name, email):',
	'',
	'Product name:',
	'What the product does:',
	'Use (keep one): distributed to end users / run as a hosted service / both',
	'Revenue band of your group (keep one): under €1M / €1M–€10M / over €10M',
	'What you need (start date, questions):',
	''
];

export const header: readonly Link[] = [
	{ route: '/docs', label: 'Docs' },
	{ route: '/how-it-works', label: 'How it works' },
	{ route: '/head-to-head', label: 'Head-to-head' },
	{ route: '/pro', label: 'Pro' },
	{ route: '/company-licence', label: 'Company licence' }
];

export const product: readonly Link[] = [
	{ route: '/', label: 'Home' },
	{ route: '/how-it-works', label: 'How it works' },
	{ route: '/head-to-head', label: 'Head-to-head' },
	{ route: '/pro', label: 'Strikta Pro' },
	{ route: '/company-licence', label: 'Company licence' },
	{ route: '/docs', label: 'Docs' }
];

/** The mark a draft legal page shows in its <main>. */
export const DRAFT = 'Draft, not in force';

/** The security policy, an exported legal text on its own page. */
export const security: LegalPage = { route: '/security', label: 'Security', file: 'legal/security.md', draft: false };

export const help: readonly Link[] = [
	{ route: '/support', label: 'Support' },
	security,
	{ route: '/company', label: 'Company and contact' }
];

export const legal: readonly LegalPage[] = [
	{ route: '/legal/licence-terms', label: 'Licence Terms', file: 'legal/licence-terms.md', draft: true },
	{ route: '/legal/refund-policy', label: 'Refund policy', file: 'legal/refund-policy.md', draft: true },
	{ route: '/legal/privacy', label: 'Privacy notice', file: 'legal/privacy.md', draft: false },
	{ route: '/legal/trademarks', label: 'Trademarks', file: 'legal/trademarks.md', draft: false },
	{ route: '/legal/support-period', label: 'Support period', file: 'legal/support-period.md', draft: true },
	{ route: '/legal/company-licence', label: 'Company licence terms', file: 'legal/company-licence.md', draft: false }
];

/** The prefilled company-licence enquiry to licensing@strikta.dev. */
export const enquiry = `mailto:licensing@strikta.dev?subject=${encodeURIComponent(ENQUIRY_SUBJECT)}&body=${encodeURIComponent(ENQUIRY_FIELDS.join('\n'))}`;

/** The links whose pages the current stage builds, in their order. */
export function stagedLinks<Entry extends Link>(links: readonly Entry[]): readonly Entry[] {
	const shown = links.filter((link) => staged(link.route));
	return shown;
}
