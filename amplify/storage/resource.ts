import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'amplifyTeamDrive',
  access: (allow) => ({
    '{entity_id}/*': [
      allow.guest.to(['read']),
      allow.entity('identity').to(['read'])
    ],
    '/*': [
      allow.authenticated.to(['read']),
      allow.guest.to(['read'])
    ],
  })
});