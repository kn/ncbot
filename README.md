# New Caster Bot

Recasts new users for their first 3 days on Farcaster.

You can run it locally using the following command:
```
yarn run bot
```

Running this command doesn't actually post unless FARCASTER_SEED_PHRASE environment variable is set.

`yarn run bot` is scheduled to be run on [Render](https://dashboard.render.com/cron/crn-ccpqp5ien0hr84ne2u8g) every 5 mins. The code gets updated simply by pushing the changes to the main branch.
