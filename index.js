import { ethers, Wallet } from 'ethers'
import fetch from 'node-fetch'
import { publishCast } from '@standard-crypto/farcaster-js'
import { createClient } from '@supabase/supabase-js'

/*
 * Constants
 */
const SUPABASE_URL = 'https://kpwbglpxjuhiqtgtvenz.supabase.co'
const READ_ONLY_SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtwd2JnbHB4anVoaXF0Z3R2ZW56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NTgzNzg2MjEsImV4cCI6MTk3Mzk1NDYyMX0.zecokpSRK0MI_nOaSAgFZJCMkPSpEXraPKqQD5fogE4'
const supabase = createClient(SUPABASE_URL, READ_ONLY_SUPABASE_KEY)
const NCBOT_USERNAME = 'ncbot'
const RECAST_PREFIX = 'recast:farcaster://casts/'

// We recast new users for 3 days.
const RECAST_FOR_USER_HR = 72
// We recast up to 10 casts per user.
const MAX_RECAST_PER_USER = 5

// We recast new casts posted up to 1 hour ago.
const RECAST_FOR_CAST_HR = 1

// Skip users in this list
const USERNAMES_TO_SKIP = [
  'welcome', // Requested by @zachterrell
]

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

const getCasts = async (username) => {
  return await fetchWithLog(
    `https://searchcaster.xyz/api/search?username=${username}`
  )
}

const getLatestSequenceRecastedPerAddress = async () => {
  const latestSequences = {}
  const recastCounts = {}
  const publishedThreshold = getTimeAgo(RECAST_FOR_USER_HR)
  let botCasts = await getCasts(NCBOT_USERNAME)
  let passedThreshold = false
  do {
    const { casts, meta } = botCasts
    for (const cast of casts) {
      const { body } = cast
      if (body.publishedAt < publishedThreshold) {
        passedThreshold = true
        break
      }
      recastCounts[body.address] ||= 0
      recastCounts[body.address]++
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
  return { latestSequences, recastCounts }
}

const getPrivateKey = () => {
  const mnemonic = process.env.FARCASTER_SEED_PHRASE
  if (!mnemonic) return null

  const hdNode =
    ethers.utils.HDNode.fromMnemonic(mnemonic).derivePath("m/44'/60'/0'/0/0")
  return hdNode.privateKey
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

  const privateKey = getPrivateKey()
  const signer = privateKey && new Wallet(privateKey)

  const { latestSequences, recastCounts } =
    await getLatestSequenceRecastedPerAddress()
  console.log(
    `Found ${
      Object.keys(latestSequences).length
    } users recasted in the past ${RECAST_FOR_USER_HR} hours.`
  )

  const publishedAtThreshold = getTimeAgo(RECAST_FOR_CAST_HR)
  for (const user of users) {
    if (user.username.startsWith('__tt__')) {
      continue // Skip test users
    }
    if (USERNAMES_TO_SKIP.includes(user.username)) {
      continue
    }
    if (recastCounts[user.address] >= MAX_RECAST_PER_USER) {
      console.log(
        `Skipping ${user.username} because casted more than ${MAX_RECAST_PER_USER} times already.`
      )
      continue // Skip because exceeded max recasts
    }
    const userCasts = await getCasts(user.username)
    let recastCount = recastCounts[user.username]
    for (const cast of userCasts.casts.reverse()) {
      if (recastCount > MAX_RECAST_PER_USER) {
        console.log(
          `Skipping the rest of ${user.username}'s casts since recasted ${MAX_RECAST_PER_USER} times already.`
        )
        break
      }

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
        latestSequences[username] !== undefined &&
        sequence <= latestSequences[username]
      ) {
        continue // Skip if already recasted by ncbot
      }
      if (data.text.startsWith('Authenticating my Farcaster account')) {
        continue // Skip auth casts
      }
      signer && (await publishCast(signer, RECAST_PREFIX + cast.merkleRoot))
      recastCount++
      console.log('')
      console.log(`Recasted @${username}: ${data.text}`)
    }
  }

  console.log('Done.')
}

recastNewUsers()
