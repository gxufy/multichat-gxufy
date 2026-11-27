/** @jsxImportSource ./jsx */
/*
 * The chat overlay's rows as shared parts: an ordinary chat line (badges,
 * name, paint, reply, redeem, source tag, avatar, Shared Chat source) and every
 * event row (Twitch subscriptions and their transitions, gifts, raids, cheers,
 * announcements, milestones, and the generic system strip). The JSX here
 * builds parts (lib/render/jsx), which the overlay draws.
 *
 * Three pieces are stateful and are slots each renderer fills: the Hype Train
 * row ('hype-train'), the raid avatar ('raid-avatar', falls back to its icon)
 * and the cheermote art ('cheermote-art', animated then static then icon).
 */
import { Fragment } from './jsx/jsx-runtime';
import { componentSlot, type ChatPart, type ElementStyle } from './elementTree';
import { referenceWeightParts } from './referenceText';
import { PROVIDERS, rowSourceTagPart, type SourceTagMode } from '../renderCore';
import type { MessageNode, ParsedMessage } from '../kick';
import type { MultichatConfig } from '../multichatConfig';
import type { SizeGeometry } from '../chatOverlayView';
import type {
  HypeTrainEventData,
  Platform,
  TwitchAnnouncementEventData,
  TwitchCheerEventData,
  TwitchGiftEventData,
  TwitchMilestoneEventData,
  TwitchRaidEventData,
  TwitchSubscriptionEventData,
  TwitchSubscriptionTransitionEventData,
} from '../types';

/** Text wrapped for reference weight (see referenceText.ts). */
function ReferenceWeightText({ children }: { children?: unknown }): ChatPart {
  return { $el: true, tag: '', children: referenceWeightParts(flatten(children)) };
}

function flatten(children: unknown, into: ChatPart[] = []): ChatPart[] {
  if (children === null || children === undefined || typeof children === 'boolean' || children === '') return into;
  if (Array.isArray(children)) {
    for (const child of children) flatten(child, into);
    return into;
  }
  into.push(typeof children === 'number' ? String(children) : (children as ChatPart));
  return into;
}

/**
 * The person's name in an event row. With a 7TV (or JilTV) paint it is drawn
 * as a painted chat name is: the painted word keeps the paint's own shadows
 * (its filter) and sits on a plain copy of the word that carries the overlay's
 * text shadow and outline (the ::before layer of .gx-event-name-paint), so a
 * painted name is shadowed like the rest of its row. Unpainted names keep
 * their colour; the reference-weight layer gives them the same shadow.
 */
function EventName({
  msg,
  className,
  text,
  color,
  paint = true,
  fontWeight,
}: {
  msg: ParsedMessage;
  className: string;
  text: string;
  color: string | undefined;
  /** False for a name that isn't the painted person's (an anonymous gifter). */
  paint?: boolean;
  /** The generic event strip names people at chat-name weight. */
  fontWeight?: number;
}): ChatPart {
  if (!paint || !msg.identity.background) {
    return (
      <span className={className} style={{ color }}>
        {text}
      </span>
    );
  }
  return (
    <span className={`${className} gx-event-name-paint`} data-gx-glyph={text} style={fontWeight ? { fontWeight } : undefined}>
      <span
        className="gx-event-name-paint-fg"
        style={{
          color,
          backgroundImage: msg.identity.background,
          filter: msg.identity.filter || undefined,
          backgroundSize: msg.identity.backgroundSize ?? 'cover',
          backgroundRepeat: msg.identity.backgroundRepeat,
          WebkitTextFillColor: 'transparent',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
        }}
      >
        {text}
      </span>
    </span>
  );
}

/** Slot: the Hype Train row (progress bar and level-up celebration). */
function HypeTrainEventRow(props: { data: HypeTrainEventData }): ChatPart {
  return componentSlot('hype-train', props);
}

/** Slot: the raider's avatar, or `fallback` when there is none or it fails to load. */
function RaidAvatar(props: { src: string; fallback: ChatPart }): ChatPart {
  return componentSlot('raid-avatar', props);
}

/** Slot: the cheermote art (animated, then static, then the bits icon). */
function TwitchCheermoteArt(props: { visual: TwitchCheerEventData['cheermotes'][number] | undefined }): ChatPart {
  return componentSlot('cheermote-art', props);
}

function twitchSubPlanLabel(
  plan: string,
): string {
  switch (
    plan.toLowerCase()
  ) {
    case 'prime':
      return 'Prime';

    case '1000':
      return 'Tier 1';

    case '2000':
      return 'Tier 2';

    case '3000':
      return 'Tier 3';

    default:
      return (
        plan.trim()
          ? plan
          : 'sub'
      );
  }
}

function twitchAnnouncementColor(
  color: string,
): string {
  switch (
    color.toUpperCase()
  ) {
    case 'BLUE':
      return '#3b82f6';

    case 'GREEN':
      return '#22c55e';

    case 'ORANGE':
      return '#f97316';

    case 'PURPLE':
      return '#a855f7';

    case 'PRIMARY':
    default:
      return '#9147ff';
  }
}

type TwitchEventIconKind =
  | 'prime'
  | 'gift'
  | 'raid'
  | 'watch-streak'
  | 'bits'
  | 'modiversary'
  | 'announcement';

export function TwitchEventIcon({
  kind,
}: {
  kind: TwitchEventIconKind;
}) {
  const common = {
    className: 'gx-event-icon-svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    focusable: false,
    'aria-hidden': true,
  };

  switch (kind) {
    case 'prime':
      return (
        <svg {...common}>
          <path d="m3 7 4.2 4 4.8-7 4.8 7L21 7l-2 11H5L3 7Z" />
          <path d="M5 21h14" />
        </svg>
      );

    case 'gift':
      return (
        <svg {...common}>
          <path d="M3 9h18v12H3zM2 5h20v4H2zM12 5v16" />
          <path d="M12 5H7.7A2.2 2.2 0 1 1 10 2.8L12 5Zm0 0h4.3A2.2 2.2 0 1 0 14 2.8L12 5Z" />
        </svg>
      );

    case 'raid':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.3" />
          <path d="M3 20c.3-4 2.3-6 6-6s5.7 2 6 6M14 15c3.8 0 6 1.7 6.4 5" />
        </svg>
      );

    case 'watch-streak':
      return (
        <svg {...common}>
          <path d="M13.2 2.5c.6 3.2-.7 4.7-2.1 6.3-1.1-1-1.5-2.1-1.4-3.6C6 7.8 4 10.7 4 14a8 8 0 0 0 16 0c0-4.3-2.4-8.3-6.8-11.5Z" />
          <path d="M12 11c2 2 2.8 3.2 2.8 4.8a2.8 2.8 0 1 1-5.6 0c0-1.4.8-2.8 2.8-4.8Z" />
        </svg>
      );

    case 'bits':
      return (
        <svg {...common}>
          <path d="m12 2 7 7-7 13L5 9l7-7Z" />
          <path d="m5 9 7 4 7-4M12 2v11" />
        </svg>
      );

    case 'modiversary':
      return (
        <svg {...common}>
          <path d="m12 2.8 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.4l6.2-.9L12 2.8Z" />
        </svg>
      );

    case 'announcement':
      return (
        <svg {...common}>
          <path d="M4 10v4l11 4V6L4 10ZM15 9l5-3v12l-5-3M7 15l1.4 5h3.3l-2-4" />
        </svg>
      );
  }
}

function TwitchSubscriptionTransitionEventRow({
  msg,
  data,
  hideNames,
}: {
  msg: ParsedMessage;
  data: TwitchSubscriptionTransitionEventData;
  hideNames: boolean;
}) {
  const nameColor =
    msg.identity.color || '#a970ff';

  let action:
    string;

  let detail:
    string | undefined;

  switch (data.type) {
    case 'prime-paid-upgrade':
      action =
        'converted Prime to a paid sub';
      break;

    case 'gift-paid-upgrade':
      action =
        'continued a gifted sub';

      if (
        data.priorGifterDisplayName
      ) {
        detail =
          `originally gifted by ${data.priorGifterDisplayName}`;
      }

      break;

    case 'anonymous-gift-paid-upgrade':
      action =
        'continued an anonymous gifted sub';
      break;

    case 'standard-pay-forward':
      action =
        'paid the gift forward';

      if (
        data.recipientDisplayName &&
        data.priorGifterDisplayName
      ) {
        detail =
          `to ${data.recipientDisplayName} - originally from ${data.priorGifterDisplayName}`;
      }
      else if (
        data.recipientDisplayName
      ) {
        detail =
          `to ${data.recipientDisplayName}`;
      }
      else if (
        data.priorGifterDisplayName
      ) {
        detail =
          `originally from ${data.priorGifterDisplayName}`;
      }

      break;

    case 'community-pay-forward':
      action =
        'paid the gift forward to the community';

      if (
        data.priorGifterDisplayName
      ) {
        detail =
          `originally from ${data.priorGifterDisplayName}`;
      }

      break;
  }

  const showDetail =
    !hideNames &&
    Boolean(detail);

  const iconKind:
    TwitchEventIconKind =
      data.type ===
      'prime-paid-upgrade'
        ? 'prime'
        : 'gift';

  return (
    <div
      className="gx-event-strip gx-event-subscription gx-sub-card"
      data-testid="twitch-subscription-transition-row"
      data-transition-type={data.type}
      style={
        {
          '--gx-event-accent':
            '#c9a7ff',
        } as ElementStyle
      }
    >
      <span
        className="gx-event-icon gx-sub-icon"
        aria-hidden="true"
      >
        <TwitchEventIcon
          kind={iconKind}
        />
      </span>

      <span className="gx-event-copy gx-sub-copy">
        <ReferenceWeightText>
        <span className="gx-event-header gx-sub-header">
          {!hideNames && (
            <>
              {msg.identity.badges.length >
                0 && (
                <span className="gx-event-badges gx-sub-badges">
                  {msg.identity.badges.map(
                    (
                      badge,
                      index,
                    ) => (
                      <Fragment
                        key={index}
                      >
                        {badge}
                      </Fragment>
                    ),
                  )}
                </span>
              )}

              <EventName
                msg={msg}
                className="gx-event-name gx-sub-name"
                text={msg.identity.username}
                color={nameColor}
              />
            </>
          )}

          <span className="gx-event-action gx-sub-action">
            {action}
            {data.plan && (
              <>
                {' with '}
              {twitchSubPlanLabel(
                data.plan,
              )}
              </>
            )}
          </span>

          {data.promoGiftTotal && (
            <span className="gx-event-meta">
              {data.promoGiftTotal.toLocaleString()}
              {' promo '}
              {data.promoGiftTotal ===
              1
                ? 'gift'
                : 'gifts'}
            </span>
          )}
        </span>

        {showDetail && (
          <span className="gx-event-body gx-sub-body">
            {detail}
          </span>
        )}

        {data.promoName && (
          <span className="gx-event-body gx-sub-body">
            {data.promoName}
          </span>
        )}

        {msg.message.length >
          0 && (
          <span className="gx-event-body gx-sub-body ck-body">
            {msg.message.map(
              (
                node,
                index,
              ) => (
                <Fragment
                  key={index}
                >
                  {node}
                </Fragment>
              ),
            )}
          </span>
        )}
        </ReferenceWeightText>
      </span>
    </div>
  );
}

function TwitchAnnouncementEventRow({
  msg,
  data,
  hideNames,
}: {
  msg: ParsedMessage;
  data: TwitchAnnouncementEventData;
  hideNames: boolean;
}) {
  const color =
    twitchAnnouncementColor(
      data.color,
    );

  return (
    <div
      className="gx-event-strip gx-event-announcement gx-announcement-card"
      data-testid="twitch-announcement-row"
      style={
        {
          '--gx-event-accent':
            color,
        } as ElementStyle
      }
    >
      <span
        className="gx-event-icon gx-notice-icon"
        aria-hidden="true"
      >
        <TwitchEventIcon
          kind="announcement"
        />
      </span>

      <span className="gx-event-copy gx-notice-copy">
        <ReferenceWeightText>
        <span className="gx-event-header gx-notice-header">
          {!hideNames && (
            <>
              {msg.identity.badges.length > 0 && (
                <span className="gx-event-badges">
                  {msg.identity.badges.map((badge, index) => (
                    <Fragment key={index}>
                      {badge}
                    </Fragment>
                  ))}
                </span>
              )}

              <EventName
                msg={msg}
                className="gx-event-name gx-notice-name"
                text={msg.identity.username}
                color={msg.identity.color || color}
              />
            </>
          )}

          <span className="gx-event-action gx-notice-action">
            announced
          </span>
        </span>

        {msg.message.length >
          0 && (
          <span className="gx-event-body gx-notice-body ck-body">
            {msg.message.map(
              (
                node,
                index,
              ) => (
                <Fragment
                  key={index}
                >
                  {node}
                </Fragment>
              ),
            )}
          </span>
        )}
        </ReferenceWeightText>
      </span>
    </div>
  );
}

function TwitchMilestoneEventRow({
  msg,
  data,
  hideNames,
}: {
  msg: ParsedMessage;
  data: TwitchMilestoneEventData;
  hideNames: boolean;
}) {
  const visual =
    data.type ===
    'watch-streak'
      ? {
          color:
            '#f6c344',
          icon:
            'watch-streak' as const,
          action:
            `watched ${data.value.toLocaleString()} consecutive streams`,
        }
      : data.type ===
        'bits-badge'
        ? {
            color:
              '#38bdf8',
            icon:
              'bits' as const,
            action:
              `unlocked the ${data.value.toLocaleString()} Bits badge`,
          }
        : {
            color:
              '#22c55e',
            icon:
              'modiversary' as const,
            action:
              `celebrates ${data.value.toLocaleString()} months as a moderator`,
          };

  return (
    <div
      className="gx-event-strip gx-event-milestone gx-milestone-card"
      data-testid="twitch-milestone-row"
      data-milestone-type={data.type}
      style={
        {
          '--gx-event-accent':
            visual.color,
        } as ElementStyle
      }
    >
      <span
        className="gx-event-icon gx-notice-icon"
        aria-hidden="true"
      >
        <TwitchEventIcon
          kind={visual.icon}
        />
      </span>

      <span className="gx-event-copy gx-notice-copy">
        <ReferenceWeightText>
        <span className="gx-event-header gx-notice-header">
          {!hideNames && (
            <>
              {msg.identity.badges.length > 0 && (
                <span className="gx-event-badges">
                  {msg.identity.badges.map((badge, index) => (
                    <Fragment key={index}>
                      {badge}
                    </Fragment>
                  ))}
                </span>
              )}

              <EventName
                msg={msg}
                className="gx-event-name gx-notice-name"
                text={msg.identity.username}
                color={msg.identity.color || visual.color}
              />
            </>
          )}

          <span className="gx-event-action gx-notice-action">
            {visual.action}
          </span>

          {data.channelPoints && (
            <span className="gx-event-meta gx-notice-pill">
              +
              {data.channelPoints.toLocaleString()}
              {' points'}
            </span>
          )}
        </span>

        {msg.message.length >
          0 && (
          <span className="gx-event-body gx-notice-body ck-body">
            {msg.message.map(
              (
                node,
                index,
              ) => (
                <Fragment
                  key={index}
                >
                  {node}
                </Fragment>
              ),
            )}
          </span>
        )}
        </ReferenceWeightText>
      </span>
    </div>
  );
}

function TwitchRaidEventRow({
  msg,
  data,
  hideNames,
}: {
  msg: ParsedMessage;
  data: TwitchRaidEventData;
  hideNames: boolean;
}) {
  const nameColor =
    msg.identity.color || '#ff8fbb';

  const showAvatar =
    !hideNames &&
    Boolean(
      data.profileImageUrl,
    );

  return (
    <div
      className="gx-event-strip gx-event-raid gx-raid-card"
      data-testid="twitch-raid-row"
      data-raid-viewers={data.viewers}
      style={
        {
          '--gx-event-accent':
            '#8da8ff',
        } as ElementStyle
      }
    >
      <span className="gx-event-icon gx-raid-avatar-wrap">
        {/* The avatar is stateful (it gives way to the icon if it fails to
            load), so each renderer draws it; the icon is shared. */}
        <RaidAvatar
          src={showAvatar ? data.profileImageUrl ?? '' : ''}
          fallback={(
            <span
              className="gx-event-icon-fallback gx-raid-avatar-fallback"
              aria-hidden="true"
            >
              <TwitchEventIcon
                kind="raid"
              />
            </span>
          )}
        />
      </span>

      <span className="gx-event-copy gx-raid-copy">
        <ReferenceWeightText>
        <span className="gx-event-header gx-raid-header">
          {!hideNames && (
            <>
              {msg.identity.badges.length > 0 && (
                <span className="gx-event-badges">
                  {msg.identity.badges.map((badge, index) => (
                    <Fragment key={index}>
                      {badge}
                    </Fragment>
                  ))}
                </span>
              )}

              <EventName
                msg={msg}
                className="gx-event-name gx-raid-name"
                text={data.raiderDisplayName}
                color={nameColor}
              />
            </>
          )}

          <span className="gx-event-action gx-raid-action">
            raided with{' '}
            <span className="gx-event-accent gx-event-inline-value gx-raid-count">
              {data.viewers.toLocaleString()}{' '}
              {data.viewers === 1
                ? 'viewer'
                : 'viewers'}
            </span>
          </span>
        </span>

        {!hideNames &&
          data.raiderLogin &&
          data.raiderLogin.toLowerCase() !==
            data.raiderDisplayName.toLowerCase() && (
            <span className="gx-event-subline gx-raid-subline">
              @{data.raiderLogin}
            </span>
          )}
        </ReferenceWeightText>
      </span>
    </div>
  );
}

function TwitchGiftEventRow({
  msg,
  data,
  hideNames,
}: {
  msg: ParsedMessage;
  data: TwitchGiftEventData;
  hideNames: boolean;
}) {
  const nameColor =
    msg.identity.color || '#ff91ad';

  const plan =
    twitchSubPlanLabel(
      data.plan,
    );

  const recipients =
    data.recipients ??
    [];

  return (
    <div
      className="gx-event-strip gx-event-gift gx-gift-card"
      data-testid="twitch-gift-row"
      data-gift-type={data.type}
      data-gift-count={data.count}
      style={
        {
          '--gx-event-accent':
            '#ffb184',
        } as ElementStyle
      }
    >
      <span
        className="gx-event-icon gx-gift-icon"
        aria-hidden="true"
      >
        <TwitchEventIcon
          kind="gift"
        />
      </span>

      <span className="gx-event-copy gx-gift-copy">
        <ReferenceWeightText>
        <span className="gx-event-header gx-gift-header">
          {!hideNames && (
            <>
              {msg.identity.badges.length >
                0 && (
                <span className="gx-event-badges gx-gift-badges">
                  {msg.identity.badges.map(
                    (
                      badge,
                      index,
                    ) => (
                      <Fragment
                        key={index}
                      >
                        {badge}
                      </Fragment>
                    ),
                  )}
                </span>
              )}

              <EventName
                msg={msg}
                className="gx-event-name gx-gift-name"
                text={data.anonymous ? 'Anonymous' : msg.identity.username}
                color={nameColor}
                paint={!data.anonymous}
              />
            </>
          )}

          {data.type ===
          'community' ? (
            <span className="gx-event-action gx-gift-action">
              gifted{' '}
              {data.count.toLocaleString()}{' '}
              {plan} subs
            </span>
          ) : (
            <>
              <span className="gx-event-action gx-gift-action">
                gifted a {plan} sub
                {data.recipient &&
                !hideNames
                  ? ' to'
                  : ''}
              </span>

              {data.recipient &&
                !hideNames && (
                  <span className="gx-event-accent gx-event-inline-value gx-gift-recipient">
                    {' '}
                    {
                      data.recipient
                        .displayName
                    }
                  </span>
                )}
            </>
          )}

          {data.senderCount && (
            <span className="gx-event-meta gx-gift-total">
              {data.senderCount.toLocaleString()}{' '}
              total gifted
            </span>
          )}
        </span>

        {data.type ===
          'community' &&
          recipients.length >
            0 &&
          !hideNames && (
            <span className="gx-event-subline gx-gift-recipients">
              {recipients.length.toLocaleString()}
              {' of '}
              {data.count.toLocaleString()}
              {' gifted to '}
              {recipients.map(
                (
                  recipient,
                  index,
                ) => (
                  <Fragment
                    key={
                      recipient.userId ??
                      recipient.username ??
                      `${recipient.displayName}-${index}`
                    }
                  >
                    {index >
                      0 && ', '}

                    <span className="gx-event-accent gx-gift-recipient-list-name">
                      {
                        recipient.displayName
                      }
                    </span>
                  </Fragment>
                ),
              )}
            </span>
          )}
        </ReferenceWeightText>
      </span>
    </div>
  );
}

function TwitchSubscriptionEventRow({
  msg,
  data,
  hideNames,
}: {
  msg: ParsedMessage;
  data: TwitchSubscriptionEventData;
  hideNames: boolean;
}) {
  const nameColor =
    msg.identity.color;

  const plan =
    twitchSubPlanLabel(
      data.plan,
    );

  const action =
    data.type === 'resub'
      ? (
          `resubscribed for ${data.months.toLocaleString()} ` +
          (
            data.months === 1
              ? 'month'
              : 'months'
          ) +
          ` with ${plan}`
        )
      : `subscribed with ${plan}`;

  const streak =
    data.streakMonths &&
    data.streakMonths > 1
      ? (
          ` - ${data.streakMonths.toLocaleString()} month streak`
        )
      : '';

  return (
    <div
      className="gx-event-strip gx-event-subscription gx-sub-card"
      data-testid="twitch-subscription-row"
      data-sub-type={data.type}
      data-sub-months={data.months}
      style={
        {
          '--gx-event-accent':
            '#c9a7ff',
        } as ElementStyle
      }
    >
      <span
        className="gx-event-icon gx-sub-icon"
        aria-hidden="true"
      >
        <TwitchEventIcon
          kind={
            data.plan.toLowerCase() ===
            'prime'
              ? 'prime'
              : 'gift'
          }
        />
      </span>

      <span className="gx-event-copy gx-sub-copy">
        <ReferenceWeightText>
        <span className="gx-event-header gx-sub-header">
          {!hideNames && (
            <>
              {msg.identity.badges.length >
                0 && (
                <span className="gx-event-badges gx-sub-badges">
                  {msg.identity.badges.map(
                    (
                      badge,
                      index,
                    ) => (
                      <Fragment
                        key={index}
                      >
                        {badge}
                      </Fragment>
                    ),
                  )}
                </span>
              )}

              <EventName
                msg={msg}
                className="gx-event-name gx-sub-name"
                text={msg.identity.username}
                color={nameColor}
              />
            </>
          )}

          <span className="gx-event-action gx-sub-action">
            {action}
            {streak}
          </span>
        </span>

        {msg.message.length > 0 &&
          !(
            msg.message.length === 1 &&
            msg.message[0] === ''
          ) && (
            <span className="gx-event-body gx-sub-body ck-body">
              {msg.message.map(
                (
                  node,
                  index,
                ) => (
                  <Fragment
                    key={index}
                  >
                    {node}
                  </Fragment>
                ),
              )}
            </span>
          )}
        </ReferenceWeightText>
      </span>
    </div>
  );
}


function TwitchCheerEventRow({
  msg,
  data,
  hideNames,
}: {
  msg: ParsedMessage;
  data: TwitchCheerEventData;
  hideNames: boolean;
}) {
  const primary =
    data.cheermotes.reduce<
      TwitchCheerEventData[
        'cheermotes'
      ][number] | undefined
    >(
      (
        current,
        candidate,
      ) =>
        !current ||
        candidate.bits >
          current.bits
          ? candidate
          : current,
      undefined,
    );

  const color =
    primary?.color ??
    '#9147ff';

  const nameColor =
    msg.identity.color;

  return (
    <div
      className="gx-event-strip gx-event-bits gx-cheer-card"
      data-testid="twitch-cheer-row"
      data-cheer-bits={data.bits}
      style={
        {
          '--gx-event-accent':
            color,
        } as ElementStyle
      }
    >
      <span className="gx-event-icon gx-cheer-art">
        <TwitchCheermoteArt
          visual={primary}
        />
      </span>

      <span className="gx-event-copy gx-cheer-copy">
        <ReferenceWeightText>
        <span className="gx-event-header gx-cheer-header">
          {!hideNames && (
            <>
              {msg.identity.badges.length >
                0 && (
                <span className="gx-event-badges gx-cheer-badges">
                  {msg.identity.badges.map(
                    (
                      badge,
                      index,
                    ) => (
                      <Fragment
                        key={
                          index
                        }
                      >
                        {badge}
                      </Fragment>
                    ),
                  )}
                </span>
              )}

              <EventName
                msg={msg}
                className="gx-event-name gx-cheer-name"
                text={msg.identity.username}
                color={nameColor}
              />
            </>
          )}

          <span className="gx-event-action gx-cheer-amount">
            cheered{' '}
            <span className="gx-event-accent gx-event-inline-value">
              {data.bits.toLocaleString()}{' '}
              {data.bits === 1
                ? 'bit'
                : 'bits'}
            </span>
          </span>
        </span>

        <span className="gx-event-body gx-cheer-body ck-body">
          {msg.message.map(
            (
              node,
              index,
            ) => (
              <Fragment
                key={index}
              >
                {node}
              </Fragment>
            ),
          )}
        </span>
        </ReferenceWeightText>
      </span>
    </div>
  );
}

const CATEGORY_ICON: Record<string, string> = {
  subscription: '★', gift: '🎁', raid: '👥', cheer: '💰',
  milestone: '🔥', follow: '❤️', announcement: '📣',
};

const CATEGORY_EVENT_CLASS: Record<string, string> = {
  subscription: 'gx-event-subscription',
  gift: 'gx-event-gift',
  raid: 'gx-event-raid',
  cheer: 'gx-event-bits',
  milestone: 'gx-event-milestone',
  follow: 'gx-event-follow',
  announcement: 'gx-event-announcement',
};

function splitLeadingEventUsername(msg: ParsedMessage): MessageNode[] | null {
  const username = msg.identity.username.trim();
  const first = msg.message[0];
  if (!username || typeof first !== 'string') return null;
  if (first.slice(0, username.length).toLowerCase() !== username.toLowerCase()) return null;

  const boundary = first.charAt(username.length);
  if (boundary && !/[\s:,–—-]/u.test(boundary)) return null;

  const remainder = first.slice(username.length).replace(/^\s+/u, '');
  return remainder
    ? [remainder, ...msg.message.slice(1)]
    : msg.message.slice(1);
}

export function MsgLine({ msg, sz, emoteMaxH, emoteMaxW, paintEdgeShadow, hideNames, tagMode, showAvatar, showSharedSource, replyStyle }: {
  msg: ParsedMessage; sz: SizeGeometry;
  emoteMaxH:string; emoteMaxW:string; paintEdgeShadow:string;
  hideNames:boolean;
  tagMode:SourceTagMode; showAvatar:boolean; showSharedSource:boolean;
  replyStyle: MultichatConfig['replyStyle'];
}) {
  const isPaint = !!msg.identity.background;
  const pill = msg.identity.namePill?.split('|');
  const nameStyle: ElementStyle = pill
    ? {
        background:pill[0],
        color:pill[1],
        borderRadius:'0.4em',
        padding:'0 0.35em',
        WebkitTextStroke:'0px',
        textShadow:'none',
        fontWeight:800,
      }
    : isPaint
    ? {
        backgroundImage:msg.identity.background,
        filter:msg.identity.filter || undefined,
        WebkitTextFillColor:'transparent',
        WebkitBackgroundClip:'text',
        backgroundClip:'text',
        backgroundSize:msg.identity.backgroundSize ?? 'cover',
        backgroundRepeat:msg.identity.backgroundRepeat,
        WebkitTextStroke:'0px',
        textShadow:'none',
        fontWeight:800,
      }
    : {
        color:msg.identity.color,
        fontWeight:800,
      };

  const visualPlatform = msg.displayPlatform ?? msg.platform;
  const tag = visualPlatform ? rowSourceTagPart(visualPlatform, tagMode) : null;


  const avatar = showAvatar && msg.avatar && (msg.platform === 'youtube' || msg.platform === 'tiktok') ? (
    <img src={msg.avatar} alt="" loading="lazy" referrerPolicy="no-referrer"
      style={{ width:'1.5em', height:'1.5em', minWidth:'1.5em', borderRadius:9999,
               objectFit:'cover', marginRight:'0.4em', verticalAlign:'-0.32em',
               display:'inline-block' }}
      $onError="display-none" />
  ) : null;
  const sourceChannel = showSharedSource && msg.sourceChannel?.profileImageUrl ? (
    <span data-testid="twitch-shared-source" title="Twitch Shared Chat"
      style={{ display:'inline-flex', alignItems:'center', marginRight:'0.35em', verticalAlign:'middle', opacity:0.9 }}>
      <img src={msg.sourceChannel.profileImageUrl} alt="" loading="lazy" referrerPolicy="no-referrer"
        style={{ width:'1.45em', height:'1.45em', borderRadius:'0.25em', objectFit:'cover' }}
        $onError="display-none" />
    </span>
  ) : null;

  const badgesNode = msg.identity.badges.length > 0 && (
    <span className="ck-bw">
      {msg.identity.badges.map((b,i) => <Fragment key={i}>{b}</Fragment>)}
    </span>
  );
  const nameNode = pill ? (
    <span
      className="ck-name ck-chat-name ck-name-pill"
      style={nameStyle}
    >
      {`${msg.identity.username}:`}
    </span>
  ) : isPaint ? (
    <span
      className="ck-name ck-chat-name ck-name-paint"
      style={{
        display:'inline-grid',
        fontWeight:800,
        textShadow:'none',
      }}
    >
      {paintEdgeShadow ? (
        <span
          aria-hidden="true"
          className="gx-paint-edge"
          style={{
            gridArea:'1 / 1',
            color:'transparent',
            textShadow:paintEdgeShadow,
            WebkitTextStroke:'0px',
            zIndex:1,
            pointerEvents:'none',
          }}
        >
          {`${msg.identity.username}:`}
        </span>
      ) : null}

      <span
        className="gx-paint-foreground"
        style={{
          ...nameStyle,
          gridArea:'1 / 1',
          zIndex:2,
        }}
      >
        {`${msg.identity.username}:`}
      </span>
    </span>
  ) : (
    <span
      className="ck-name ck-chat-name"
      style={nameStyle}
    >
      <ReferenceWeightText>
        {`${msg.identity.username}:`}
      </ReferenceWeightText>
    </span>
  );

if (
    msg.kind === 'system' &&
    msg.category === 'hypetrain' &&
    msg.hypeTrain
  ) {
    return (
      <div
        style={{
          lineHeight: sz.lineHeight,
          wordBreak: 'break-word',
          display: 'flex',
          alignItems: 'center',
          gap: '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <HypeTrainEventRow
          data={msg.hypeTrain}
        />
      </div>
    );
  }

  if (
    msg.kind === 'system' &&
    msg.platform === 'twitch' &&
    msg.category === 'subscription' &&
    msg.twitchSubscriptionTransition
  ) {
    return (
      <div
        style={{
          lineHeight:
            sz.lineHeight,
          wordBreak:
            'break-word',
          display:
            'flex',
          alignItems:
            'center',
          gap:
            '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <TwitchSubscriptionTransitionEventRow
          msg={msg}
          data={
            msg.twitchSubscriptionTransition
          }
          hideNames={
            hideNames
          }
        />
      </div>
    );
  }

  if (
    msg.kind === 'system' &&
    msg.platform === 'twitch' &&
    msg.category === 'announcement' &&
    msg.twitchAnnouncement
  ) {
    return (
      <div
        style={{
          lineHeight:
            sz.lineHeight,
          wordBreak:
            'break-word',
          display:
            'flex',
          alignItems:
            'center',
          gap:
            '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <TwitchAnnouncementEventRow
          msg={msg}
          data={
            msg.twitchAnnouncement
          }
          hideNames={
            hideNames
          }
        />
      </div>
    );
  }

  if (
    msg.kind === 'system' &&
    msg.platform === 'twitch' &&
    msg.category === 'milestone' &&
    msg.twitchMilestone
  ) {
    return (
      <div
        style={{
          lineHeight:
            sz.lineHeight,
          wordBreak:
            'break-word',
          display:
            'flex',
          alignItems:
            'center',
          gap:
            '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <TwitchMilestoneEventRow
          msg={msg}
          data={
            msg.twitchMilestone
          }
          hideNames={
            hideNames
          }
        />
      </div>
    );
  }

  if (
    msg.kind === 'system' &&
    msg.platform === 'twitch' &&
    msg.category === 'raid' &&
    msg.twitchRaid
  ) {
    return (
      <div
        style={{
          lineHeight:
            sz.lineHeight,
          wordBreak:
            'break-word',
          display:
            'flex',
          alignItems:
            'center',
          gap:
            '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <TwitchRaidEventRow
          msg={msg}
          data={msg.twitchRaid}
          hideNames={hideNames}
        />
      </div>
    );
  }

  if (
    msg.kind === 'system' &&
    msg.platform === 'twitch' &&
    msg.category === 'gift' &&
    msg.twitchGift
  ) {
    return (
      <div
        style={{
          lineHeight:
            sz.lineHeight,
          wordBreak:
            'break-word',
          display:
            'flex',
          alignItems:
            'center',
          gap:
            '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <TwitchGiftEventRow
          msg={msg}
          data={msg.twitchGift}
          hideNames={hideNames}
        />
      </div>
    );
  }

  if (
    msg.kind === 'system' &&
    msg.platform === 'twitch' &&
    msg.category === 'subscription' &&
    msg.twitchSubscription
  ) {
    return (
      <div
        style={{
          lineHeight:
            sz.lineHeight,
          wordBreak:
            'break-word',
          display:
            'flex',
          alignItems:
            'center',
          gap:
            '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <TwitchSubscriptionEventRow
          msg={msg}
          data={msg.twitchSubscription}
          hideNames={hideNames}
        />
      </div>
    );
  }

  if (
    msg.kind === 'system' &&
    msg.platform === 'twitch' &&
    msg.category === 'cheer' &&
    msg.twitchCheer
  ) {
    return (
      <div
        style={{
          lineHeight:
            sz.lineHeight,
          wordBreak:
            'break-word',
          display:
            'flex',
          alignItems:
            'center',
          gap:
            '.3em',
        }}
      >
        {tag && (
          <span
            style={{
              flexShrink: 0,
            }}
          >
            {tag}
          </span>
        )}

        {sourceChannel}

        <TwitchCheerEventRow
          msg={msg}
          data={msg.twitchCheer}
          hideNames={
            hideNames
          }
        />
      </div>
    );
  }

  if (msg.kind === 'system') {
    const color = msg.platform ? PROVIDERS[msg.platform as Platform].color : '#888';
    const category = msg.category ?? 'announcement';
    const eventClass = CATEGORY_EVENT_CLASS[category] ?? 'gx-event-announcement';
    const eventBody = splitLeadingEventUsername(msg);
    return (
      <div style={{ lineHeight:sz.lineHeight, wordBreak:'break-word', display:'flex', alignItems:'flex-start', gap:'0.3em' }}>
        {tag && <span style={{ flexShrink:0 }}>{tag}</span>}
        {sourceChannel}
        <div
          className={`gx-event-strip ${eventClass}`}
          data-testid="system-event-row"
          data-event-platform={msg.platform}
          data-event-category={category}
          style={{ '--gx-event-accent': color } as ElementStyle}
        >
          <span className="gx-event-icon" aria-hidden="true">
            <span className="gx-event-icon-fallback">
              {CATEGORY_ICON[category] ?? '📣'}
            </span>
          </span>
          <span className="gx-event-copy">
            <ReferenceWeightText>
              {eventBody ? (
                <span className="gx-event-header">
                  {/* Hidden names: the event without its person, as the
                      Twitch event rows do. */}
                  {hideNames ? null : isPaint && !pill ? (
                    <EventName
                      msg={msg}
                      className="gx-event-name"
                      text={msg.identity.username}
                      color={msg.identity.color}
                      fontWeight={800}
                    />
                  ) : (
                    <span className="gx-event-name" style={nameStyle}>
                      {msg.identity.username}
                    </span>
                  )}
                  <span className="gx-event-generic-text ck-body">
                    {eventBody.map((node,i) => <Fragment key={i}>{node}</Fragment>)}
                  </span>
                </span>
              ) : (
                <span className="gx-event-generic-text ck-body">
                  {msg.message.map((node,i) => <Fragment key={i}>{node}</Fragment>)}
                </span>
              )}
            </ReferenceWeightText>
          </span>
        </div>
      </div>
    );
  }


  const redeemWrap = (inner: ChatPart) => (
    <div style={{
      borderLeft: '0.22em solid #9147ff',
      background: 'linear-gradient(90deg, rgba(145,71,255,0.18), transparent 70%)',
      padding: '0 0 0 0.4em', borderRadius: 3,
    }}>
      {typeof msg.redeem === 'string' && msg.redeem !== 'highlighted' && (
        <div style={{ fontSize: '0.6em', opacity: 0.75, fontWeight: 700, lineHeight: 1.6 }}>
          {/* One text node, as every renderer draws it the same way. */}
          {`🎁 ${msg.redeem}`}
        </div>
      )}
      {inner}
    </div>
  );

  const replyNode = msg.reply && replyStyle === 'full' ? (
    <div style={{
      fontSize:'0.6em', lineHeight:1.35, opacity:0.68,
      marginLeft:'0.35em',
      paddingLeft:'0.45em', borderLeft:'2px solid rgba(255,255,255,0.28)',
      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
    }}>
      <span className="ck-body">
        <ReferenceWeightText>
          <span aria-hidden="true">↪ </span>
          <strong style={{ fontWeight:800 }}>{msg.reply.username}</strong>
          {msg.reply.text ? (
            <>
              {' '}
              {msg.reply.renderedText?.length
                ? msg.reply.renderedText
                : msg.reply.text}
            </>
          ) : ''}
        </ReferenceWeightText>
      </span>
    </div>
  ) : null;

  const replyMention = msg.reply && replyStyle === 'mention'
    ? <><strong style={{ fontWeight:800 }}>{msg.reply.username.startsWith('@') ? msg.reply.username : '@' + msg.reply.username}</strong>{' '}</>
    : null;

  const messageLine = (
    <div style={{ lineHeight:sz.lineHeight, wordBreak:'break-word' }}>
      {tag}
      {sourceChannel}
      {avatar}
      {!hideNames && (
        <span style={{ display:'inline' }}>
          {badgesNode}{nameNode}
        </span>
      )}
      <span className={`ck-body ck-chat-body${msg.gigantifiedEmote ? ' ck-gigantified' : ''}`}>
        <ReferenceWeightText>
          {replyMention}
          {msg.message.map((node,i) => <Fragment key={i}>{node}</Fragment>)}
        </ReferenceWeightText>
      </span>
    </div>
  );

  const line = replyNode ? <div>{replyNode}{messageLine}</div> : messageLine;
  return msg.redeem ? redeemWrap(line) : line;
}

export { HypeTrainCard } from './hypeTrainCard';

/** The startup card shown until the overlay's chat arrives (any phase but hidden). */
export function ChatStartupLoader({ phase }: { phase: 'visible' | 'fading' }) {
  return (
        <div className="ck-startup-loader" data-phase={phase} data-testid="chat-startup-loader">
          <div className="ck-startup-card">
            <img className="ck-startup-logo" src="/flosschat-logo.png" alt="" width={127} height={192} decoding="async" />
            <div className="ck-startup-copy">
              <p className="ck-startup-title">FlossChat</p>
              <p className="ck-startup-byline">Every chat. One overlay. · by @Gxufy</p>
              <p className="ck-startup-status">
                <span className="ck-startup-spinner" aria-hidden="true" />
                Loading chat…
              </p>
            </div>
          </div>
        </div>
  );
}
