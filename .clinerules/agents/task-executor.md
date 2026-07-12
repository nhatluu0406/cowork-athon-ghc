Input:

{
  task
}

Steps:

1. Read files
2. Apply changes
3. Run verification steps
4. Fix failures (max 3 attempts)
5. Return result

Output:

{
  status,
  files_changed,
  tests,
  criteria
}