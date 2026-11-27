import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Terms from './+page.svelte';

describe('/support/terms', () => {
	const { head, body } = render(Terms);

	it('has the owner’s terms, refunds, privacy and contact', () => {
		expect(head).toContain('<title>Supporter terms | FlossChat</title>');
		expect(body).toContain('Sanctioned $5, Suvy $10, Top Suvy $20, or a custom amount from $5 to $500, which gets the best badge it reaches.');
		expect(body).toContain('A custom amount counts toward the next badge too.');
		expect(body).toContain('you pay only the difference to the next one');
		expect(body).toContain('only 25 accounts ever get the Founder badge. It goes to the first accounts with a paid badge, and Gxufy may also give some as gifts.');
		expect(body).toContain('takes back what that payment unlocked');
		expect(body).not.toContain('$5 or more, you choose.');
		expect(body).toContain('id="refunds"');
		expect(body).toContain('sales are final once the badge unlocks');
		expect(body).toContain('Stripe purchases are “Sold through Link”');
		expect(body).toContain('Link may also refund a payment within 60 days in some cases.');
		expect(body).toContain('Availability:</strong> FlossChat relies on Twitch, Kick, YouTube and TikTok');
		expect(body).toContain('the most we owe you for anything to do with a badge is what you paid for it.');
		expect(body).toContain('If these terms change, we update this page and its date before the change applies.');
		expect(body).toContain('id="privacy"');
		expect(body).toContain('mailto:unstoppableboy99@gmail.com');
	});
});
