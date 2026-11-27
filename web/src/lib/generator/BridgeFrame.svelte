<script lang="ts">
	/*
	 * A preview frame that draws with the production overlay renderer (see
	 * app/src/lib/previewBridge.ts). The box is the IsolatedPreviewFrame box:
	 * the OBS source's aspect ratio at the card's width, with the frame drawn
	 * 1/scale larger and scaled back down, so everything inside shrinks
	 * together. Every payload is posted as soon as this mounts, again each
	 * time the frame says it is listening, and whenever it changes (snapshots,
	 * so Svelte proxies never cross). Either side may start first: a frame
	 * that loaded before this page woke gets the first post; one that loads
	 * later says ready and gets everything again.
	 */
	import {
		PREVIEW_FRAME_PATHS,
		isPreviewFrameReady,
		type PreviewFrameKind
	} from '@/lib/previewBridge';

	let {
		kind,
		title,
		width,
		height,
		scale = 100,
		testId,
		payloads
	}: {
		kind: PreviewFrameKind;
		title: string;
		/** Canonical OBS width, for the aspect ratio only. */
		width: number;
		/** Canonical OBS height, for the aspect ratio only. */
		height: number;
		/** Preview-only zoom, as a percentage. Never reaches the overlay. */
		scale?: number;
		testId?: string;
		/**
		 * The update messages to keep the frame in step with. Each entry is posted
		 * on its own whenever it changes, so a moving message feed doesn't resend
		 * the (larger) cosmetics.
		 */
		payloads: ReadonlyArray<() => Record<string, unknown>>;
	} = $props();

	let frame: HTMLIFrameElement | undefined = $state();
	/* Counts the frame's ready messages: a frame that (re)loads says ready and
	   gets everything again. */
	let readyCount = $state(0);

	const factor = $derived(Math.min(1, Math.max(0.25, scale / 100)));

	$effect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) return;
			if (!frame || event.source !== frame.contentWindow) return;
			if (isPreviewFrameReady(event.data, kind)) readyCount += 1;
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	});

	/* The list itself is fixed for the frame's life; each entry is a getter. */
	// svelte-ignore state_referenced_locally
	for (const payload of payloads) {
		$effect(() => {
			const message = $state.snapshot(payload());
			void readyCount;
			/* A frame that isn't listening yet just drops it; its ready brings it back. */
			frame?.contentWindow?.postMessage(message, window.location.origin);
		});
	}
</script>

<div
	style:width="100%"
	style:aspect-ratio={`${width} / ${height}`}
	style:overflow="hidden"
	data-preview-ratio={`${width}/${height}`}
	data-testid={testId}
	data-preview-ready={readyCount > 0 ? 'true' : 'false'}
>
	<iframe
		bind:this={frame}
		{title}
		src={PREVIEW_FRAME_PATHS[kind]}
		scrolling="no"
		style:display="block"
		style:width={`${(100 / factor).toFixed(4)}%`}
		style:height={`${(100 / factor).toFixed(4)}%`}
		style:transform={factor === 1 ? undefined : `scale(${factor})`}
		style:transform-origin="0 0"
		style:border="none"
		style:background="transparent"
	></iframe>
</div>
