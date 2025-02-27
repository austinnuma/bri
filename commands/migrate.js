async function migrateMemoriesToVectors() {
  const { data } = await supabase.from('user_conversations').select('user_id, memory');
  for (const user of data) {
    if (user.memory) {
      const memories = user.memory.split('\n').filter(m => m.trim());
      for (const memoryText of memories) {
        await insertNewMemory(user.user_id, memoryText);
      }
    }
  }
}

migrateMemoriesToVectors();