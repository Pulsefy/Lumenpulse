import { View } from 'react-native';

export default function ListSkeleton() {
  return (
    <View style={{ padding: 16 }}>
      {[...Array(5)].map((_, i) => (
        <View
          key={i}
          style={{
            height: 60,
            backgroundColor: '#222',
            marginBottom: 10,
            borderRadius: 8,
          }}
        />
      ))}
    </View>
  );
}
