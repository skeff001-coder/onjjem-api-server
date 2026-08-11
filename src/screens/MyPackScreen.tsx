const COLLECTION_SLOTS = [
  { id: 1, name: "My Pups Slot", locked: false, label: "Active" },
  { id: 2, name: "Gundog Breed Slot", locked: true, label: "Slot 2 Locked" },
  { id: 3, name: "Terrier Breed Slot", locked: true, label: "Slot 3 Locked" },
  { id: 4, name: "Toy Breed Slot", locked: true, label: "Slot 4 Locked" },
  { id: 5, name: "Working Breed Slot", locked: true, label: "Slot 5 Locked" },
];

// Inside your screen render block:
<View style={styles.gridContainer}>
  {COLLECTION_SLOTS.map((slot) => (
    <View key={slot.id} style={slot.locked ? styles.lockedCard : styles.unlockedCard}>
      {slot.locked ? <Icon name="lock" size={24} color="#888" /> : <Image source={{ uri: currentDogImage }} />}
      <Text style={styles.slotLabel}>{slot.label}</Text>
    </View>
  ))}
</View>

