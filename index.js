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
const NCBOT_ADDRESS = '0xb79aF3B13F54c0739F0183f1207F7AB80EDd40DE'
const RECAST_PREFIX = 'recast:farcaster://casts/'
const NCBOT_FID = 258

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

const getCasts = async (fid, cursor) => {
  return await fetchWithLog(
    `https://api.farcaster.xyz/v2/casts?fid=${fid}&cursor=${cursor}`
  )
}

const getLatestSequenceRecastedPerAddress = async () => {
  const latestSequences = {}
  const recastCounts = {}
  const publishedThreshold = getTimeAgo(RECAST_FOR_USER_HR)
  let casts = await getCasts(NCBOT_FID)
  let passedThreshold = false
  do {
    const { result, next } = casts
    for (const cast of result.casts) {
      const { timestamp, author } = cast
      if (timestamp < publishedThreshold) {
        passedThreshold = true
        break
      }
      recastCounts[author.fid] ||= 0
      recastCounts[author.fid]++
      if (
        !latestSequences[author.fid] ||
        latestSequences[author.fid] < body.sequence
      ) {
        latestSequences[author.fid] = body.sequence
      }
    }
    if (passedThreshold) {
      break
    }
    if (next.cursor) {
      casts = await getCasts(NCBOT_FID, next.cursor)
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
    if (recastCounts[user.fid] >= MAX_RECAST_PER_USER) {
      console.log(
        `Skipping ${user.username} because casted more than ${MAX_RECAST_PER_USER} times already.`
      )
      continue // Skip because exceeded max recasts
    }
    const casts = await getCasts(NCBOT_FID)
    let recastCount = recastCounts[user.fid]
    for (const cast of casts.result.casts.reverse()) {
      if (recastCount > MAX_RECAST_PER_USER) {
        console.log(
          `Skipping the rest of ${user.username}'s casts since recasted ${MAX_RECAST_PER_USER} times already.`
        )
        break
      }

      const { hash, timestmap, recasts, parentHash, text } = cast

      if (recasts?.count) {
        continue // Skip because recasts
      }
      if (timestmap < publishedAtThreshold) {
        continue // Skip if casted before the threshold
      }
      if (parentHash) {
        continue // Skip replies
      }
      if (
        latestSequences[address] !== undefined &&
        sequence <= latestSequences[address]
      ) {
        continue // Skip if already recasted by ncbot
      }
      if (text.startsWith('Authenticating my Farcaster account')) {
        continue // Skip auth casts
      }
      signer && (await publishCast(signer, RECAST_PREFIX + hash))
      recastCount++
      console.log('')
      console.log(`Recasted @${username}: ${text}`)
    }
  }

  console.log('Done.')
}

recastNewUsers()
