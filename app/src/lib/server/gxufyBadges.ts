export type GxufyBadgeDefinition = {
  id: string;
  title: string;
  url: string;
  userIds: string[];
};

const GXUFY_BADGES: GxufyBadgeDefinition[] = [
  {
    id: 'supporter',
    title: 'Gxufy Supporter',
    url: '/badges/gxufy/supporter.webp',
    userIds: ['204219574'],
  },
];

export async function getGxufyBadges(): Promise<GxufyBadgeDefinition[]> {
  return GXUFY_BADGES;
}
