import { Wallet } from 'ethers'
import fetch from 'node-fetch'
import { AlchemyProvider } from '@ethersproject/providers'
import { publishCast } from '@standard-crypto/farcaster-js'
import { createClient } from '@supabase/supabase-js'

/*
 * Constants
 */
const SUPABASE_URL = 'https://kpwbglpxjuhiqtgtvenz.supabase.co'
const READ_ONLY_SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtwd2JnbHB4anVoaXF0Z3R2ZW56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NTgzNzg2MjEsImV4cCI6MTk3Mzk1NDYyMX0.zecokpSRK0MI_nOaSAgFZJCMkPSpEXraPKqQD5fogE4'
const supabase = createClient(SUPABASE_URL, READ_ONLY_SUPABASE_KEY)

const NCBOT_ADDRESS = '0x4E9c142eE16e45FFB32Ece493b8e00E8Eeb47260'
const RECAST_PREFIX = 'recast:farcaster://casts/'

// We recast new users for 3 days.
const RECAST_FOR_USER_HR = 72

// We recast new casts posted up to 1 hour ago.
const RECAST_FOR_CAST_HR = 1

/*
 * Helper functions
 */
const getTimeAgo = (hours) => {
  const now = new Date().getTime()
  return new Date(now - hours * 60 * 60 * 1000).getTime()
}

/*
 * Supabase helper functions
 */
const getEntryCreatedAtThreshold = () => {
  return Math.floor(getTimeAgo(RECAST_FOR_USER_HR) / 1000)
}

const getNewUsers = async () => {
  const { data, error } = await supabase
    .from('account_view')
    .select('username, address')
    .gt('entry_created_at', getEntryCreatedAtThreshold())

  if (error) {
    console.error(error)
    throw new Error(error.message)
  }

  return data
}

/*
 * Farcaster API helper functions
 */
const fetchWithLog = async (url) => {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.warn(`Could not fetch ${url}: ${res.statusText}`)
      return null
    }
    return await res.json()
  } catch (e) {
    console.warn(`Could not fetch ${url}: ${e.message}`)
    return null
  }
}

const getCasts = async (address) => {
  return await fetchWithLog(
    `https://api.farcaster.xyz/v1/profiles/${address}/casts`
  )
}

const getLatestSequenceRecastedPerAddress = async () => {
  const latestSequences = {}
  const publishedThreshold = getTimeAgo(RECAST_FOR_USER_HR)
  let casts = await getCasts(NCBOT_ADDRESS)
  let passedThreshold = false
  do {
    const { result, meta } = casts
    for (const cast of result.casts) {
      const { body } = cast
      if (body.publishedAt < publishedThreshold) {
        passedThreshold = true
        break
      }
      if (
        !latestSequences[body.address] ||
        latestSequences[body.address] < body.sequence
      ) {
        latestSequences[body.address] = body.sequence
      }
    }
    if (passedThreshold) {
      break
    }
    if (meta.next) {
      casts = await fetchWithLog(meta.next)
    } else {
      break
    }
  } while (true)
  return latestSequences
}

/*
 * Main function
 */
const recastNewUsers = async () => {
  const users = await getNewUsers()
  console.log(
    `There are ${users.length} new users created in the past ${RECAST_FOR_USER_HR} hours.`
  )

  if (!users.length) return

  const provider = new AlchemyProvider('goerli')
  const wallet = process.env.FARCASTER_SEED_PHRASE
    ? Wallet.fromMnemonic(process.env.FARCASTER_SEED_PHRASE)
    : null

  const latestSequences = getLatestSequenceRecastedPerAddress()
  console.log(
    `Found ${
      Object.keys(latestSequences).length
    } users recasted in the past ${RECAST_FOR_USER_HR} hours.`
  )

  for (const user of users) {
    if (user.username.startsWith('__tt__')) {
      continue // Skip test users
    }
    const casts = await getCasts(user.address)
    const publishedAtThreshold = getTimeAgo(RECAST_FOR_CAST_HR)
    for (const cast of casts.result.casts.reverse()) {
      const { body, meta } = cast
      const { address, data, publishedAt, sequence, username } = body
      if (meta.recast) {
        continue // Skip because recasts
      }
      if (publishedAt < publishedAtThreshold) {
        continue // Skip if casted before the threshold
      }
      if (data.replyParentMerkleRoot) {
        continue // Skip replies
      }
      if (
        latestSequences[address] !== undefined &&
        sequence <= latestSequences[address]
      ) {
        continue // Skip if already recasted by ncbot
      }
      if (data.text.startsWith('Authenticating my Farcaster account')) {
        continue // Skip auth casts
      }
      wallet &&
        (await publishCast(wallet, provider, RECAST_PREFIX + cast.merkleRoot))
      console.log(`Recasted @${username}: ${data.text}`)
    }
  }

  console.log('Done.')
}

recastNewUsers()
