import * as core from '@actions/core'
import {createCommentIfFromCopilotDefender} from './create-comment'

async function run(): Promise<void> {
  try {
    const commentId = parseInt(core.getInput('comment_id'))

    await createCommentIfFromCopilotDefender(commentId)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
