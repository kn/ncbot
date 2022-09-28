import { Wallet } from 'ethers'
import fetch from 'node-fetch'
import { AlchemyProvider } from '@ethersproject/providers'
import { publishCast } from '@standard-crypto/farcaster-js'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://kpwbglpxjuhiqtgtvenz.supabase.co'
const READ_ONLY_SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtwd2JnbHB4anVoaXF0Z3R2ZW56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2NTgzNzg2MjEsImV4cCI6MTk3Mzk1NDYyMX0.zecokpSRK0MI_nOaSAgFZJCMkPSpEXraPKqQD5fogE4'
const supabase = createClient(
  SUPABASE_URL,
  process.env.SUPABASE_KEY || READ_ONLY_SUPABASE_KEY
)
const NCBOT_ADDRESS = '0x4E9c142eE16e45FFB32Ece493b8e00E8Eeb47260'
const RECAST_PREFIX = 'recast:farcaster://casts/'

// We recast new users for 3 days.
const RECAST_FOR_HR = 72

// Prevent recasting many posts when ncbot start
const NCBOT_START_TIME = 1664329238684

const getEntryCreatedAtThreshold = () => {
  const now = new Date().getTime()
  return Math.floor(
    new Date(now - RECAST_FOR_HR * 60 * 60 * 1000).getTime() / 1000
  )
}

const getNewUsers = async () => {
  const { data, error } = await supabase
    .from('account_view')
    .select('id, address')
    .gt('entry_created_at', getEntryCreatedAtThreshold())

  if (error) {
    console.error(error)
    throw new Error(error.message)
  }

  return data
}

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

const getIndexThreshold = () => {
  const now = new Date().getTime()
  return new Date(now - RECAST_FOR_HR * 2 * 60 * 60 * 1000).getTime()
}

const getLatestSequenceRecasted = async () => {
  const index = {}
  const publishedThreshold = getIndexThreshold()
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
      if (!index[body.address] || index[body.address] < body.sequence) {
        index[body.address] = body.sequence
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
  return index
}

const recastNewUsers = async () => {
  const users = await getNewUsers()
  console.log(
    `There are ${users.length} new users created in the past ${RECAST_FOR_HR} hours.`
  )

  if (!users.length) return

  const provider = new AlchemyProvider('goerli')
  const wallet = process.env.FARCASTER_SEED_PHRASE
    ? Wallet.fromMnemonic(process.env.FARCASTER_SEED_PHRASE)
    : ''

  const latestSequenceRecasted = getLatestSequenceRecasted()
  console.log(
    `Found ${
      Object.keys(latestSequenceRecasted).length
    } users recasted in the past ${RECAST_FOR_HR * 2} hours.`
  )

  for (const user of users) {
    const casts = await getCasts(user.address)
    for (const cast of casts.result.casts.reverse()) {
      const { body } = cast
      const { address, sequence } = body
      if (user.address.toLowerCase() !== address.toLowerCase()) {
        continue // Skip recasts
      }
      if (body.publishedAt < NCBOT_START_TIME) {
        continue
      }
      if (
        latestSequenceRecasted[address] === undefined ||
        sequence > latestSequenceRecasted[address]
      ) {
        wallet &&
          (await publishCast(wallet, provider, RECAST_PREFIX + cast.merkleRoot))
        console.log(`Recasted @${body.username}: ${body.data.text}`)
      }
    }
  }

  console.log('Done.')
}

recastNewUsers()
