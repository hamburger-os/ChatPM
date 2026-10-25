/**
 * ChatPM-owned IM contract. Provider sender IDs are untrusted and never grant
 * a ChatPM user or an Agent permission to mutate a domain object.
 */
export type ChannelId = 'wecom';

export interface ChannelCapabilities {
  readonly directMessages: boolean;
  readonly groupMentions: boolean;
  readonly passiveGroupMessages: boolean;
  readonly groupHistory: boolean;
  readonly proactiveText: boolean;
  readonly interactiveCards: boolean;
  readonly attachments: boolean;
}
export interface InboundText {
  readonly channel: ChannelId;
  readonly accountId: string;
  readonly externalMessageId: string;
  readonly externalActorId: string;
  readonly route: { readonly kind: 'direct' | 'group'; readonly externalConversationId: string };
  readonly text: string;
  readonly sourceCreatedAt: string | null;
}
export interface OutboundText {
  readonly accountId: string;
  readonly route: { readonly kind: 'direct' | 'group'; readonly externalConversationId: string };
  readonly text: string;
}
export type AcceptInbound = (event: InboundText) => Promise<void>;
export interface ChannelAdapter {
  readonly id: ChannelId;
  readonly capabilities: ChannelCapabilities;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** SDK acceptance is not an end-user delivery or read receipt. */
  send(message: OutboundText): Promise<{ readonly state: 'accepted' }>;
}
export function inboundIdentity(event: InboundText): string {
  return JSON.stringify([event.channel, event.accountId, event.externalMessageId]);
}
