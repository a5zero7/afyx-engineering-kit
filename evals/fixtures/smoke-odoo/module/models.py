def set_tag_ids(record, tag_ids):
    record.write({"tag_ids": [fields.Command.set(tag_ids)]})
