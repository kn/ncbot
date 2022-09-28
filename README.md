# New Caster Bot

This bot publish top 3 links daily on Farcaster and Twitter.

You can run it locally using the following command:
```
yarn run bot
```

This doesn't actually post unless FARCASTER_SEED_PHRASE environment variable is set.

`yarn run bot` is scheduled to run on [Render](https://dashboard.render.com/cron/crn-ccpqp5ien0hr84ne2u8g) every day at 5 mins. The code gets updated simply by pushing the changes to the main branch.
