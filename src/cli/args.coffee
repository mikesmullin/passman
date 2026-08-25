# Minimal argv parser for passman CLI.

# Short flags that are boolean (do not consume the next token).
BOOL_SHORT =
  v: "verbose"
  j: "json"
  h: "help"
  n: "no-newline"

# Short flags that take a value.
VALUE_SHORT =
  f: "field"

export parseArgs = (argv) ->
  user = [argv...]
  dd = user.indexOf "--"
  passthrough = []
  main = user
  if dd >= 0
    passthrough = user.slice dd + 1
    main = user.slice 0, dd

  positionals = []
  flags = {}
  cmd = null

  tokens = main
  i = 0
  while i < tokens.length
    a = tokens[i]

    if a is "-h" or a is "--help"
      flags.help = true
      i++
      continue

    if a.startsWith "--"
      eq = a.indexOf "="
      if eq > 0
        key = a.slice 2, eq
        if key is "vault"
          throw new Error "--vault was removed; set PASSMAN_VAULT=<path.kdbx> instead"
        flags[key] = a.slice eq + 1
        i++
        continue
      key = a.slice 2
      if key is "vault"
        throw new Error "--vault was removed; set PASSMAN_VAULT=<path.kdbx> instead"
      # boolean long flags
      if key in ["verbose", "json", "reveal", "no-masking", "no-mask", "no-newline", "help"]
        flags[key] = true
        i++
        continue
      next = tokens[i + 1]
      if next and not next.startsWith "-"
        flags[key] = next
        i++
      else
        flags[key] = true
      i++
      continue

    if a.startsWith("-") and a.length is 2
      ch = a[1]
      if BOOL_SHORT[ch]
        flags[BOOL_SHORT[ch]] = true
        i++
        continue
      if VALUE_SHORT[ch]
        long = VALUE_SHORT[ch]
        next = tokens[i + 1]
        if next and not next.startsWith "-"
          flags[long] = next
          i++
        else
          flags[long] = true
        i++
        continue
      flags[ch] = true
      i++
      continue

    if not cmd?
      cmd = a
    else
      positionals.push a
    i++

  { cmd: cmd or "help", positionals, flags, passthrough }

export flagStr = (flags, names...) ->
  for n in names
    v = flags[n]
    return v if typeof v is "string" and v.length > 0
  undefined

export flagBool = (flags, names...) ->
  for n in names
    return true if flags[n] is true or flags[n] is "true" or flags[n] is "1"
  false
