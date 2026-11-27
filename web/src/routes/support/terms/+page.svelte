<script lang="ts">
	/*
	 * Supporter terms, privacy and contact. The wording is the published
	 * terms; change it only together with them.
	 */
	import '#lib/styles/reset.css';
	import SiteIcons from '#lib/site/SiteIcons.svelte';
	import { SUPPORT_CONTACT_EMAIL } from '#lib/support/supportInfo.ts';
</script>

<SiteIcons />

<svelte:head>
	<title>Supporter terms | FlossChat</title>
	<meta name="robots" content="noindex,nofollow,noarchive" />
	<meta name="description" content="Terms, refunds and privacy for FlossChat supporter badges." />
</svelte:head>

<main class="terms">
	<a class="back" href="/support">← Back to support</a>
	<h1>Supporter terms</h1>
	<p class="updated">Last updated November 26, 2026</p>

	<section aria-labelledby="terms-title">
		<h2 id="terms-title">Terms</h2>
		<p>Supporter badges are optional one-time purchases that help pay for FlossChat. FlossChat stays free for everyone.</p>
		<ul>
			<li><strong>What you get:</strong> a cosmetic badge next to one Twitch name in FlossChat. It’s linked to that account, so it stays if the name changes.</li>
			<li><strong>Prices:</strong> Sanctioned $5, Suvy $10, Top Suvy $20, or a custom amount from $5 to $500, which gets the best badge it reaches. One time, in US dollars, shown before you pay. No subscription.</li>
			<li><strong>Payments add up:</strong> if the account already has a badge, you pay only the difference to the next one, and it keeps the badges below it. A custom amount counts toward the next badge too. One badge shows at a time; pick it on the badges page.</li>
			<li><strong>Founder:</strong> only 25 accounts ever get the Founder badge. It goes to the first accounts with a paid badge, and Gxufy may also give some as gifts. Free tier badges don’t count. Once all 25 are claimed, it’s gone.</li>
			<li><strong>Paying:</strong> handled by PayPal, or by Stripe for cards, Apple Pay and Google Pay. Stripe purchases are “Sold through Link”: Link sends your receipt and handles payment questions. We never see your card or bank details.</li>
			<li><strong>Delivery:</strong> the badge unlocks as soon as the payment goes through.</li>
			<li><strong>Gifts:</strong> a badge bought for someone else stays on their account.</li>
			<li id="refunds"><strong>Refunds:</strong> sales are final once the badge unlocks. If you were charged twice or the badge never showed up, email us within 30 days and we’ll refund you. For purchases sold through Link, Link may also refund a payment within 60 days in some cases. A refund or chargeback takes back what that payment unlocked.</li>
			<li><strong>Misuse:</strong> we can remove badges from accounts used for fraud or abuse.</li>
			<li><strong>Availability:</strong> FlossChat relies on Twitch, Kick, YouTube and TikTok, and on badge and emote services we don’t run. Any of them can change or go down, so we can’t promise FlossChat or a badge will always show.</li>
			<li><strong>Liability:</strong> FlossChat and badges are provided as they are. As far as the law allows, the most we owe you for anything to do with a badge is what you paid for it.</li>
			<li><strong>Changes:</strong> badges and prices may change for future purchases. Badges you already have stay. If these terms change, we update this page and its date before the change applies.</li>
			<li><strong>If FlossChat shuts down:</strong> we’ll post a notice on flosschat.app at least 30 days before. Badges stop showing after that.</li>
		</ul>
	</section>

	<section id="privacy" aria-labelledby="privacy-title">
		<h2 id="privacy-title">Privacy</h2>
		<p>We keep only what’s needed to give and show your badge: your Twitch ID and name, what you bought and when, and the PayPal or Stripe receipt number. Badge holders’ Twitch IDs are in FlossChat’s public badge list so overlays can show them. Email us to have your data deleted (this removes the badge).</p>
	</section>

	<section id="contact" aria-labelledby="contact-title">
		<h2 id="contact-title">Contact</h2>
		<p><a href="mailto:{SUPPORT_CONTACT_EMAIL}"><strong>{SUPPORT_CONTACT_EMAIL}</strong></a>. FlossChat is run by Gxufy and isn’t affiliated with Twitch, Kick, YouTube, TikTok, PayPal, Stripe or Link.</p>
	</section>
</main>

<style>
	:global(html),
	:global(body) {
		min-height: 100%;
		margin: 0;
		background: #0b0b0d;
	}

	.terms {
		box-sizing: border-box;
		max-width: 680px;
		min-height: 100vh;
		margin: 0 auto;
		padding: 40px 24px 72px;
		color: #d9dbe3;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		font-size: 15px;
		line-height: 1.7;
	}

	.back {
		color: #9a9fae;
		font-size: 13px;
		font-weight: 600;
		text-decoration: none;
	}

	.back:hover,
	.back:focus-visible {
		color: #fff;
	}

	h1 {
		margin: 28px 0 4px;
		color: #f6f7fb;
		font-size: 34px;
		font-weight: 800;
		letter-spacing: -0.035em;
		line-height: 1.15;
	}

	.updated {
		margin: 0 0 28px;
		color: #6f7380;
		font-size: 13px;
	}

	h2 {
		margin: 32px 0 8px;
		color: #fff;
		font-size: 18px;
		font-weight: 800;
		letter-spacing: -0.02em;
	}

	p {
		margin: 0 0 12px;
	}

	ul {
		display: grid;
		gap: 10px;
		margin: 14px 0 0;
		padding-left: 20px;
		list-style: disc;
	}

	li::marker {
		color: #4a84fa;
	}

	strong {
		color: #fff;
	}

	a {
		color: #8fb2ff;
	}
</style>
