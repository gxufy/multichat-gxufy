import {
  PREVIEW_IDENTITY_PROVIDERS,
  type PreviewIdentityProviderStatus,
} from '@/features/multichat/previewIdentity';
import type { TwitchPreviewIdentityState } from './useTwitchPreviewIdentity';

const STATUS_COPY: Record<PreviewIdentityProviderStatus, string> = {
  loaded: 'Loaded',
  unavailable: 'Unavailable',
  failed: 'Failed',
};

export default function ClassicPreviewIdentity({
  identity,
}: {
  identity: TwitchPreviewIdentityState;
}) {
  const busy = identity.status === 'loading' || identity.status === 'retrying';
  const canonical = identity.response?.identity;
  const providerDetails = PREVIEW_IDENTITY_PROVIDERS.flatMap((provider) => {
    const outcome = identity.response?.providers[provider];
    return outcome && outcome.status !== 'loaded'
      ? [`${provider}: ${outcome.status === 'unavailable' ? 'No compatible resources were available for this identity.' : 'The provider could not be loaded. Retry is available.'}`]
      : [];
  });

  return (
    <div className="preview-identity" role="group" aria-labelledby="preview-identity-heading">
      <h3 id="preview-identity-heading" className="preview-identity-title">
        Preview Identity
      </h3>
      <div className="preview-identity-form">
        <label htmlFor="preview-identity-twitch">Twitch username/channel</label>
        <div className="preview-identity-input-row">
          <input
            id="preview-identity-twitch"
            type="text"
            value={identity.input}
            placeholder="twitch username"
            onChange={(event) => identity.setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') identity.load();
            }}
          />
          <button
            type="button"
            className="classic-conn-btn"
            onClick={identity.load}
            disabled={busy}
          >
            {identity.status === 'loading' ? 'Loading…' : 'Load Preview Identity'}
          </button>
        </div>
      </div>

      <div className="preview-identity-status" role="status" aria-live="polite">
        {identity.status === 'idle' && 'Load a Twitch identity to show its real preview resources.'}
        {identity.status === 'loading' && 'Loading Preview Identity…'}
        {identity.status === 'retrying' && 'Retrying failed providers… Successful resources remain in the preview.'}
        {identity.status === 'not-found' && 'Twitch identity not found.'}
        {identity.status === 'error' && 'Unable to load Twitch Preview Identity.'}
        {canonical && (identity.status === 'success' || identity.status === 'partial' || identity.status === 'retrying') && (
          <strong>{canonical.displayName} (@{canonical.login})</strong>
        )}
      </div>

      {identity.response && (
        <>
          <div className="preview-identity-providers" aria-label="Preview Identity provider status">
            {PREVIEW_IDENTITY_PROVIDERS.map((provider) => {
              const status = identity.response?.providers[provider]?.status;
              return (
                <span
                  key={provider}
                  className="preview-identity-provider"
                  data-status={status ?? 'unavailable'}
                >
                  {provider} · {status ? STATUS_COPY[status] : 'Unavailable'}
                </span>
              );
            })}
          </div>

          {identity.failedProviders.length > 0 && (
            <button
              type="button"
              className="classic-conn-btn preview-identity-retry"
              onClick={identity.retryFailed}
              disabled={busy}
            >
              Retry failed providers
            </button>
          )}

          {providerDetails.length > 0 && (
            <details className="preview-identity-details">
              <summary>Provider details</summary>
              <ul>
                {providerDetails.map((detail) => <li key={detail}>{detail}</li>)}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
