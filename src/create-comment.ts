import {Octokit} from '@octokit/rest'
import axios from 'axios'
import fs from 'fs'

type Comment = {
  id: number
  body: string
  in_reply_to_id?: number
  diff_hunk: string
  start_line?: number | null
  line?: number
  path: string
  user: {login: string}
}

type PromptMessage = {
  role: string
  content: string
}

export async function getChatGPTResponse(
  prompt_msgs: PromptMessage[]
): Promise<string> {
  const api_key = process.env.OPENAI_API_KEY
  const base_url = process.env.OPENAI_BASE_URL
  const deployment_name = process.env.OPENAI_DEPLOYMENT_NAME
  const api_version = '2023-03-15-preview'
  const url = `${base_url}/openai/deployments/${deployment_name}/chat/completions?api-version=${api_version}`

  const payload = {
    model: deployment_name,
    messages: prompt_msgs,
    max_tokens: 1024,
    temperature: 0.2,
    n: 1
  }
  const headers = {
    'api-key': api_key,
    'Content-Type': 'application/json'
  }

  try {
    const response = await axios.post(url, payload, {headers})
    const response_text = response.data.choices[0].message.content
    return response_text
  } catch (error) {
    console.log(error)
    return ''
  }
}

async function getCopilotDefenderCommentThread(
  comments: Comment[],
  commentId: number
): Promise<Comment[]> {
  const commentMap: {[key: number]: Comment} = {}
  for (const comment of comments) {
    commentMap[comment.id] = comment
  }

  const commentThread = []
  let lastComment = commentMap[commentId]
  // Check if last comment is by copilot defender. if so, ignore it
  if (lastComment.user.login === 'copilot-defender') {
    return []
  }

  // Check if lastcomment isn't really the last comment (i.e. it has a reply)
  if (
    Object.values(commentMap).some(
      comment => comment.in_reply_to_id === commentId
    )
  ) {
    return []
  }

  while (lastComment) {
    commentThread.push(lastComment)
    if (!lastComment.in_reply_to_id) break
    lastComment = commentMap[lastComment.in_reply_to_id]
  }

  return commentThread.reverse()
}

export async function createCommentIfFromCopilotDefender(
  commentId: number
): Promise<boolean> {
  if (
    !process.env.GITHUB_REPOSITORY ||
    !process.env.GITHUB_EVENT_PATH ||
    !process.env.CPD_GITHUB_TOKEN ||
    !process.env.OPENAI_API_KEY ||
    !process.env.OPENAI_BASE_URL ||
    !process.env.OPENAI_DEPLOYMENT_NAME
  ) {
    console.log(
      'GITHUB_REPOSITORY, GITHUB_EVENT_PATH, CPD_GITHUB_TOKEN, OPENAI_API_KEY, OPENAI_BASE_URL, or OPENAI_DEPLOYMENT_NAME not set'
    )
    return false
  }
  const octokit = new Octokit({auth: process.env.CPD_GITHUB_TOKEN})
  const owner = process.env.GITHUB_REPOSITORY.split('/')[0]
  const repo = process.env.GITHUB_REPOSITORY.split('/')[1]
  const event = JSON.parse(
    fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')
  )
  if (!event.pull_request || !event.pull_request.number) {
    console.log('Not a pull request, exiting')
    return false
  }

  const pullNumber = event.pull_request.number
  const {data: comments} = await octokit.rest.pulls.listReviewComments({
    owner,
    repo,
    pull_number: pullNumber
  })

  const commentThread = await getCopilotDefenderCommentThread(
    comments,
    commentId
  )
  console.log('Comment Maybe done by Copilot defender:')
  console.log(commentThread[commentThread.length - 2])
  if (commentThread.length < 2) {
    console.log('No comment thread found, exiting')
    return false
  } else if (
    commentThread[commentThread.length - 2].user.login !== 'copilot-defender'
  ) {
    console.log('Comment is not in reply to copilot defender, exiting')
    return false
  }

  // Retrieve the suggestion
  const copilotDefenderCommentWithSuggestion = commentThread.find(
    comment => comment.user.login === 'copilot-defender'
  )

  if (!copilotDefenderCommentWithSuggestion) {
    console.log('No suggestion found, exiting')
    return false
  }

  const diffHunk = copilotDefenderCommentWithSuggestion.diff_hunk
  const startLine = copilotDefenderCommentWithSuggestion.start_line
  const endLine = copilotDefenderCommentWithSuggestion.line
  const file_contents = diffHunk.split('\n').slice(1) // To eliminate the @@ line
  if (!endLine) {
    console.log('No end line found, exiting')
    return false
  }

  const beforeCode = startLine
    ? file_contents.slice(startLine - 1, endLine).join('\n')
    : file_contents[endLine - 1]

  const previousCommentMsgs = commentThread.map((comment, i) => ({
    role: i % 2 === 0 ? 'assistant' : 'user',
    content: comment.body
  }))
  console.log('beforeCode', beforeCode)

  const promptMessages = [
    {
      role: 'system',
      content:
        'You are a helpful programming assistant who is conducting a code review. You suggest fixes to problems in the code and give helpful explanations. You reply to feedback or questions from developers in a polite and constructive way.'
    },
    {
      role: 'user',
      content: `Given the context of the files above, how can I improve this block of code?\n\n\`\`\`\n${beforeCode}\n\`\`\``
    }
  ].concat(previousCommentMsgs)

  console.log('PROMPT MESSAGES')
  console.log(promptMessages)

  const body = await getChatGPTResponse(promptMessages)
  console.log('CHATGPT RESPONSE')
  console.log(body)
  await octokit.rest.pulls.createReplyForReviewComment({
    owner,
    repo,
    body,
    pull_number: pullNumber,
    comment_id: commentId
  })
  console.log('RETURN TRUE')
  return true
}
